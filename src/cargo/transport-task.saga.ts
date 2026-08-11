import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { TransportOrderDestination as OrderDestination } from '../opentcs/domain/kernel-model';
import { TransportTaskService } from './transport-task.service';
import { DeliverySlotEngine } from './delivery-slot.engine';
import { ApproachPointService } from './approach-point.service';
import { RetreatPointService } from './retreat-point.service';
import {
  FMS_EVENTS,
  FmsDropOffUnloadedEvent,
  FmsTransportOrderFinishedEvent,
  FmsTransportOrderLostNavigationEvent,
  ORDER_PROP,
  TaskLeg,
} from './domain/events';
import { ORDER_TYPE, buildOrderName } from './domain/transport-order-name';

const MAX_LOST_NAVIGATION_RETRIES = 3;

@Injectable()
export class TransportTaskSaga {
  private readonly logger = new Logger(TransportTaskSaga.name);
  private readonly processing = new Set<string>();
  private readonly unloading = new Set<string>();

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
    private readonly deliverySlotEngine: DeliverySlotEngine,
    private readonly approachPoint: ApproachPointService,
    private readonly retreatPoint: RetreatPointService,
  ) {}

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_FINISHED)
  async onTransportOrderFinished(
    event: FmsTransportOrderFinishedEvent,
  ): Promise<void> {
    if (this.processing.has(event.taskId)) return;
    this.processing.add(event.taskId);
    try {
      switch (event.leg) {
        case 'PICKUP':
          await this.onPickupFinished(event.taskId);
          break;
        case 'APPROACH':
          await this.onApproachFinished(event.taskId);
          break;
        case 'DROPOFF':
          await this.onDropOffFinished(event.taskId);
          break;
      }
    } finally {
      this.processing.delete(event.taskId);
    }
  }

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_LOST_NAVIGATION)
  async onLegLostNavigation(
    event: FmsTransportOrderLostNavigationEvent,
  ): Promise<void> {
    if (this.processing.has(event.taskId)) return;
    this.processing.add(event.taskId);
    try {
      const task = await this.taskRepo.findOne({ where: { id: event.taskId } });
      if (!task) return;

      const retries = (task.metadata?.lostNavigationRetries ?? 0) + 1;
      if (retries > MAX_LOST_NAVIGATION_RETRIES) {
        this.logger.error(
          `Task ${task.id}: ${event.leg} lost navigation ${MAX_LOST_NAVIGATION_RETRIES} times on ${event.vehicleName} — giving up`,
        );
        await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
          trigger: 'SAGA',
          vehicleName: event.vehicleName,
          reason: `${event.leg} lost navigation ${MAX_LOST_NAVIGATION_RETRIES} times`,
        });
        return;
      }
      task.metadata = { ...task.metadata, lostNavigationRetries: retries };

      switch (event.leg) {
        case 'PICKUP':
          await this.requeueAfterLostNavigation(task, event, retries);
          break;
        case 'APPROACH':
          await this.recreateApproach(task, event, retries);
          break;
        case 'DROPOFF':
          await this.recreateDropOff(task, event, retries);
          break;
      }
    } finally {
      this.processing.delete(event.taskId);
    }
  }

  private async requeueAfterLostNavigation(
    task: TransportTaskEntity,
    event: FmsTransportOrderLostNavigationEvent,
    retries: number,
  ): Promise<void> {
    task.metadata = {
      ...task.metadata,
      to1Name: undefined,
      assignedVehicleName: undefined,
    };
    task.assignedAt = null;
    task.startedAt = null;
    await this.transportTask.changeStatus(task, TaskStatus.READY_TO_ASSIGN, {
      trigger: 'SAGA',
      vehicleName: event.vehicleName,
      context: {
        lostNavigation: true,
        retries,
        withdrawnOrder: event.orderName,
      },
    });
    this.logger.log(
      `Task ${task.id} → READY_TO_ASSIGN: ${event.vehicleName} lost navigation while picking up (retry ${retries}/${MAX_LOST_NAVIGATION_RETRIES})`,
    );
  }

  private async recreateApproach(
    task: TransportTaskEntity,
    event: FmsTransportOrderLostNavigationEvent,
    retries: number,
  ): Promise<void> {
    const approachPoint = task.metadata?.approachPointName;
    if (!approachPoint) {
      this.logger.warn(
        `Task ${task.id}: no recorded approach point to re-issue — leaving it to the reconcile backstop`,
      );
      return;
    }

    const to2Name = buildOrderName(
      ORDER_TYPE.APPROACH,
      event.vehicleName,
      approachPoint,
      randomUUID(),
    );
    const created = await this.createNextOrder(
      to2Name,
      [{ locationName: approachPoint, operation: 'MOVE' }],
      event.vehicleName,
      { taskId: task.id, leg: 'APPROACH' },
    );
    if (!created) return;

    task.metadata = { ...task.metadata, to2Name };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: re-issued approach as ${to2Name} for ${event.vehicleName} (retry ${retries}/${MAX_LOST_NAVIGATION_RETRIES})`,
    );
  }

  private async recreateDropOff(
    task: TransportTaskEntity,
    event: FmsTransportOrderLostNavigationEvent,
    retries: number,
  ): Promise<void> {
    const cargo = await this.cargoOf(task);
    const slot = cargo?.destinationLocationName;
    if (!slot) {
      this.logger.warn(
        `Task ${task.id}: no committed drop-off slot to re-issue — leaving it to the reconcile backstop`,
      );
      return;
    }

    const retreatPath = await this.retreatPoint.pathFor(slot);
    const alreadyUnloaded = Boolean(task.metadata?.unloadedAt);
    const destinations = alreadyUnloaded
      ? (retreatPath ?? []).map((cell) => ({
          locationName: cell,
          operation: 'MOVE',
        }))
      : this.dropOffDestinations(slot, retreatPath);

    if (destinations.length === 0) {
      this.logger.log(
        `Task ${task.id}: cargo already unloaded at ${slot} and no retreat leg left — completing`,
      );
      await this.onDropOffFinished(task.id);
      return;
    }

    const to3Name = buildOrderName(
      ORDER_TYPE.DROPOFF,
      event.vehicleName,
      slot,
      randomUUID(),
    );
    const created = await this.createNextOrder(
      to3Name,
      destinations,
      event.vehicleName,
      { taskId: task.id, leg: 'DROPOFF' },
    );
    if (!created) return;

    task.metadata = { ...task.metadata, to3Name };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: re-issued drop-off as ${to3Name} at ${slot} for ${event.vehicleName}${
        alreadyUnloaded ? ' (retreat only — cargo already unloaded)' : ''
      } (retry ${retries}/${MAX_LOST_NAVIGATION_RETRIES})`,
    );
  }

  @OnEvent(FMS_EVENTS.DROPOFF_UNLOADED)
  async onDropOffUnloaded(event: FmsDropOffUnloadedEvent): Promise<void> {
    if (this.unloading.has(event.taskId)) return;
    this.unloading.add(event.taskId);
    try {
      const task = await this.findTask(event.taskId, TaskStatus.DELIVERING);
      if (!task || task.metadata?.unloadedAt) return;

      task.metadata = {
        ...task.metadata,
        unloadedAt: new Date().toISOString(),
      };
      await this.taskRepo.save(task);
      this.logger.log(
        `Task ${task.id}: cargo unloaded at drop-off slot, retreat leg running`,
      );
    } finally {
      this.unloading.delete(event.taskId);
    }
  }

  private async onPickupFinished(taskId: string): Promise<void> {
    const task = await this.findTask(taskId, TaskStatus.PICKING_UP);
    if (!task) return;

    if (task.metadata?.to2Name) {
      this.logger.debug(
        `Task ${task.id}: TO2 already created — ignoring duplicate TO1 finished`,
      );
      return;
    }

    const vehicle = this.vehicleOf(task);
    if (!vehicle) {
      this.logger.warn(
        `Task ${task.id} has no assigned vehicle — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
        trigger: 'SAGA',
        reason: 'no assigned vehicle at pickup finish',
      });
      return;
    }

    const cargo = await this.cargoOf(task);
    const zone = cargo ? await this.destinationZoneOf(cargo) : null;
    if (!zone) {
      this.logger.warn(
        `Task ${task.id} has no destination zone — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
        trigger: 'SAGA',
        reason: 'no destination zone',
      });
      return;
    }

    const approachPoint = await this.approachPoint.pickFor(zone, vehicle);
    if (!approachPoint) {
      this.logger.warn(
        `Task ${task.id}: no reachable approach point for ${vehicle} — leaving PICKING_UP for the reconcile backstop to retry`,
      );
      return;
    }

    const to2Name = buildOrderName(
      ORDER_TYPE.APPROACH,
      vehicle,
      approachPoint,
      randomUUID(),
    );
    const created = await this.createNextOrder(
      to2Name,
      [{ locationName: approachPoint, operation: 'MOVE' }],
      vehicle,
      { taskId: task.id, leg: 'APPROACH' },
    );
    if (!created) return;

    task.metadata = {
      ...task.metadata,
      to2Name,
      approachPointName: approachPoint,
    };
    await this.transportTask.changeStatus(task, TaskStatus.DELIVERING, {
      trigger: 'SAGA',
      context: { to2Name },
    });
    this.logger.log(
      `Task ${task.id} → DELIVERING, created ${to2Name} (approach → ${approachPoint})`,
    );
  }

  private async destinationZoneOf(
    cargo: CargoEntity,
  ): Promise<ZoneEntity | null> {
    if (!cargo.destinationZoneId) {
      this.logger.warn(`Cargo ${cargo.id} has no destination zone`);
      return null;
    }
    const zone = await this.zoneRepo.findOne({
      where: { id: cargo.destinationZoneId },
      relations: { members: true },
    });
    if (!zone) {
      this.logger.warn(
        `Cargo ${cargo.id}: destination zone ${cargo.destinationZoneId} not found`,
      );
    }
    return zone;
  }

  private async onApproachFinished(taskId: string): Promise<void> {
    const task = await this.findTask(taskId, TaskStatus.DELIVERING);
    if (!task) return;

    if (task.metadata?.to3Name) {
      this.logger.debug(
        `Task ${task.id}: TO3 already created — ignoring duplicate TO2 finished`,
      );
      return;
    }

    const cargo = await this.cargoOf(task);
    if (!cargo) {
      this.logger.warn(`Task ${task.id} has no cargo — marking FAILED`);
      await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
        trigger: 'SAGA',
        reason: 'no cargo',
      });
      return;
    }

    const vehicle = this.vehicleOf(task);
    if (!vehicle) {
      this.logger.warn(
        `Task ${task.id} has no assigned vehicle — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
        trigger: 'SAGA',
        reason: 'no assigned vehicle at approach finish',
      });
      return;
    }

    let slot = cargo.destinationLocationName;
    if (!slot) {
      slot = await this.commitDropoffSlot(cargo);
      if (!slot) {
        this.logger.warn(
          `Task ${task.id}: no drop-off slot available at barrier — marking FAILED`,
        );
        await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
          trigger: 'SAGA',
          reason: 'no drop-off slot available at barrier',
        });
        return;
      }
    }

    const retreatPath = await this.retreatPoint.pathFor(slot);
    if (!retreatPath) {
      this.logger.warn(
        `Task ${task.id}: no retreat point behind ${slot} — drop-off goes out without the retreat leg`,
      );
    }

    const to3Name = buildOrderName(
      ORDER_TYPE.DROPOFF,
      vehicle,
      slot,
      randomUUID(),
    );
    const created = await this.createNextOrder(
      to3Name,
      this.dropOffDestinations(slot, retreatPath),
      vehicle,
      { taskId: task.id, leg: 'DROPOFF' },
    );
    if (!created) return;

    const retreatPoint = retreatPath?.at(-1);
    task.metadata = { ...task.metadata, to3Name };
    if (retreatPoint) task.metadata.retreatPointName = retreatPoint;
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: created ${to3Name} (drop-off at ${slot}${
        retreatPath ? `, retreat via ${retreatPath.join(' → ')}` : ''
      })`,
    );
  }

  private dropOffDestinations(
    slot: string,
    retreatPath: readonly string[] | null,
  ): OrderDestination[] {
    const dropOff = {
      locationName: slot,
      operation: this.kernelApi.unloadOperation,
    };
    const retreatSteps = (retreatPath ?? []).map((cell) => ({
      locationName: cell,
      operation: 'MOVE',
    }));
    return [dropOff, ...retreatSteps];
  }

  private async commitDropoffSlot(cargo: CargoEntity): Promise<string | null> {
    const zone = await this.destinationZoneOf(cargo);
    if (!zone) return null;

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [cargo.destinationZoneId],
      );
      const repo = manager.getRepository(CargoEntity);
      const fresh = await repo.findOne({ where: { id: cargo.id } });
      if (fresh?.destinationLocationName) {
        cargo.destinationLocationName = fresh.destinationLocationName;
        return fresh.destinationLocationName;
      }
      const slot = await this.deliverySlotEngine.findSlot(zone);
      if (!slot) return null;
      await repo.update(cargo.id, { destinationLocationName: slot });
      cargo.destinationLocationName = slot;
      return slot;
    });
  }

  private async onDropOffFinished(taskId: string): Promise<void> {
    const task = await this.findTask(taskId, TaskStatus.DELIVERING);
    if (!task) return;

    task.completedAt = new Date();
    await this.transportTask.changeStatus(task, TaskStatus.DELIVERY_COMPLETED, {
      trigger: 'SAGA',
    });

    if (task.cargoId) {
      await this.cargoRepo.update(task.cargoId, {
        status: CargoStatus.DELIVERED,
      });
    }
    this.logger.log(`Task ${task.id} → DELIVERY_COMPLETED`);
  }

  private findTask(
    taskId: string,
    requiredStatus: TaskStatus,
  ): Promise<TransportTaskEntity | null> {
    return this.taskRepo
      .findOne({ where: { id: taskId, status: requiredStatus } })
      .then((task) => {
        if (!task) {
          this.logger.debug(
            `No ${requiredStatus} task found for id "${taskId}"`,
          );
        }
        return task;
      });
  }

  private async createNextOrder(
    orderName: string,
    destinations: OrderDestination[],
    vehicle: string,
    props: { taskId: string; leg: TaskLeg },
  ): Promise<boolean> {
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        destinations,
        vehicle,
        { [ORDER_PROP.TASK_ID]: props.taskId, [ORDER_PROP.LEG]: props.leg },
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to create ${orderName}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private cargoOf(task: TransportTaskEntity): Promise<CargoEntity | null> {
    return task.cargoId
      ? this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : Promise.resolve(null);
  }

  private vehicleOf(task: TransportTaskEntity): string | null {
    return task.metadata?.assignedVehicleName ?? null;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { TransportOrderDestination as OrderDestination } from '../opentcs/domain/kernel-model';
import { TransportTaskService } from './transport-task.service';
import { SlotReservationService } from './slot-reservation.service';
import { DropoffOrderService } from './dropoff-order.service';
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
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
    private readonly slotReservation: SlotReservationService,
    private readonly dropoffOrder: DropoffOrderService,
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

  private async recreateDropOff(
    task: TransportTaskEntity,
    event: FmsTransportOrderLostNavigationEvent,
    retries: number,
  ): Promise<void> {
    const cargo = await this.cargoOf(task);
    const slot = cargo?.destinationLocationName ?? cargo?.reservedLocationName;
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

    if (task.metadata?.to3Name) {
      this.logger.debug(
        `Task ${task.id}: drop-off order already created — ignoring duplicate TO1 finished`,
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
    if (!cargo || !zone) {
      this.logger.warn(
        `Task ${task.id} has no destination zone — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED, {
        trigger: 'SAGA',
        reason: 'no destination zone',
      });
      return;
    }

    const reservedSlot = await this.slotReservation.reserve(cargo.id, zone);
    if (!reservedSlot) {
      this.logger.warn(
        `Task ${task.id}: zone "${zone.name}" offered no slot to reserve — leaving PICKING_UP for the reconcile backstop to retry`,
      );
      return;
    }

    const orderName = await this.dropoffOrder.issue(
      task,
      vehicle,
      reservedSlot,
    );
    if (!orderName) return;

    await this.transportTask.changeStatus(task, TaskStatus.DELIVERING, {
      trigger: 'SAGA',
      context: { to3Name: orderName, reservedSlot },
    });
    this.logger.log(
      `Task ${task.id} → DELIVERING, created ${orderName} (reserved ${reservedSlot})`,
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

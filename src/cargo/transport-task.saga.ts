import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportOrderService } from '../opentcs/transport-order.service';
import {
  ORDER_KIND,
  type IssueTransportOrder,
} from '../opentcs/domain/transport-order';
import type { TransportOrderDestination as OrderDestination } from '../opentcs/domain/kernel-model';
import { TransportTaskService } from './transport-task.service';
import { SlotReservationService } from './slot-reservation.service';
import {
  DropoffOrderService,
  retreatDestinations,
} from './dropoff-order.service';
import type { RetreatPlan } from './domain/retreat-point';
import { RetreatPointService } from './retreat-point.service';
import {
  ApproachOrderService,
  approachTargetFor,
} from './approach-order.service';
import { DeliverySlotEngine } from './delivery-slot.engine';
import {
  FMS_EVENTS,
  FmsDropOffUnloadedEvent,
  FmsTransportOrderFinishedEvent,
  FmsTransportOrderLostNavigationEvent,
} from './domain/events';

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
    private readonly transportOrders: TransportOrderService,
    private readonly transportTask: TransportTaskService,
    private readonly slotReservation: SlotReservationService,
    private readonly dropoffOrder: DropoffOrderService,
    private readonly retreatPoint: RetreatPointService,
    private readonly approachOrder: ApproachOrderService,
    private readonly deliverySlotEngine: DeliverySlotEngine,
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
      pickupOrderName: undefined,
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

    const zone = cargo ? await this.destinationZoneOf(cargo) : null;
    if (!zone) {
      this.logger.warn(
        `Task ${task.id}: no destination zone to re-issue the drop-off into`,
      );
      return;
    }

    const plan = await this.retreatPoint.planFor(slot, zone);
    const alreadyUnloaded = !!task.metadata?.unloadedAt;
    const destinations = alreadyUnloaded
      ? retreatDestinations(plan)
      : this.dropOffDestinations(slot, plan);

    if (destinations.length === 0) {
      this.logger.log(
        `Task ${task.id}: cargo already unloaded at ${slot} and no retreat leg left — completing`,
      );
      await this.onDropOffFinished(task.id);
      return;
    }

    const dropoffOrderName = await this.createNextOrder({
      kind: ORDER_KIND.DROPOFF,
      vehicleName: event.vehicleName,
      aimedAt: slot,
      destinations,
      taskId: task.id,
    });
    if (!dropoffOrderName) return;

    task.metadata = { ...task.metadata, dropoffOrderName };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: re-issued drop-off as ${dropoffOrderName} at ${slot} for ${event.vehicleName}${
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

    if (task.metadata?.dropoffOrderName) {
      this.logger.debug(
        `Task ${task.id}: drop-off order already created — ignoring duplicate pick-up finished`,
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

    const layout = await this.deliverySlotEngine.layoutFor(zone);
    if (!layout) return;

    const orderName = await this.approachOrder.aim(
      task,
      vehicle,
      approachTargetFor(layout, reservedSlot),
    );
    if (!orderName) return;

    await this.transportTask.changeStatus(task, TaskStatus.DELIVERING, {
      trigger: 'SAGA',
      context: { approachOrderName: orderName, reservedSlot },
    });
    this.logger.log(
      `Task ${task.id} → DELIVERING, ${vehicle} heading for ${reservedSlot}`,
    );
  }

  private async onApproachFinished(taskId: string): Promise<void> {
    const task = await this.findTask(taskId, TaskStatus.DELIVERING);
    if (!task || task.metadata?.approachedAt) return;

    task.metadata = {
      ...task.metadata,
      approachedAt: new Date().toISOString(),
    };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: ${task.metadata.assignedVehicleName} waiting at the zone gate for a free lane`,
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
    plan: RetreatPlan | null,
  ): OrderDestination[] {
    const dropOff = {
      locationName: slot,
      operation: this.kernelApi.unloadOperation,
    };
    return [dropOff, ...retreatDestinations(plan)];
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
    order: IssueTransportOrder,
  ): Promise<string | null> {
    try {
      return await this.transportOrders.issue(order);
    } catch (err) {
      this.logger.error(
        `Task ${order.taskId}: could not create the ${order.kind} order at ${order.aimedAt}: ${(err as Error).message}`,
      );
      return null;
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

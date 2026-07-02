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
import { TransportTaskService } from './transport-task.service';
import { DeliverySlotEngine } from './delivery-slot.engine';
import {
  FMS_EVENTS,
  FmsTransportOrderFinishedEvent,
  ORDER_PROP,
  TaskLeg,
} from './domain/events';

/**
 * Drives a transport task through its physical legs in openTCS:
 *
 *   TO1 (PICK_UP)  done → create TO2, task → DELIVERING
 *   TO2 (approach) done → create TO3 (still DELIVERING)
 *   TO3 (DROP_OFF) done → task → DELIVERY_COMPLETED, cargo → DELIVERED
 *
 * The kernel tells us "order X FINISHED" along with the wes:taskId / wes:leg
 * properties WES stamped on it; the leg decides which step just completed and
 * the task id identifies the task — the order name itself is opaque.
 */
@Injectable()
export class TransportTaskSaga {
  private readonly logger = new Logger(TransportTaskSaga.name);

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
  ) {}

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_FINISHED)
  async onTransportOrderFinished(
    event: FmsTransportOrderFinishedEvent,
  ): Promise<void> {
    switch (event.leg) {
      case 'PICKUP':
        return this.onPickupFinished(event.taskId);
      case 'APPROACH':
        return this.onApproachFinished(event.taskId);
      case 'DROPOFF':
        return this.onDropOffFinished(event.taskId);
    }
  }

  private async onPickupFinished(taskId: string): Promise<void> {
    const task = await this.findTask(taskId, TaskStatus.PICKING_UP);
    if (!task) return;

    // Idempotency: the status advance below normally filters re-fired TO1
    // events, but there's a window between creating TO2 and committing the
    // status change. If TO2 already exists, this is a duplicate — bail.
    if (task.metadata?.to2Name) {
      this.logger.debug(
        `Task ${task.id}: TO2 already created — ignoring duplicate TO1 finished`,
      );
      return;
    }

    const approachLocationName = task.metadata?.approachLocationName;
    if (!approachLocationName) {
      this.logger.warn(
        `Task ${task.id} has no approach location — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED);
      return;
    }

    const vehicle = this.vehicleOf(task);
    if (!vehicle) {
      this.logger.warn(
        `Task ${task.id} has no assigned vehicle — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED);
      return;
    }

    const to2Name = `APPROACH-${randomUUID()}`;
    const created = await this.createNextOrder(
      to2Name,
      approachLocationName,
      'NOP',
      vehicle,
      { taskId: task.id, leg: 'APPROACH' },
    );
    if (!created) return;

    task.metadata = { ...task.metadata, to2Name };
    await this.transportTask.changeStatus(task, TaskStatus.DELIVERING);
    this.logger.log(
      `Task ${task.id} → DELIVERING, created ${to2Name} (approach)`,
    );
  }

  private async onApproachFinished(taskId: string): Promise<void> {
    const task = await this.findTask(taskId, TaskStatus.DELIVERING);
    if (!task) return;

    // Idempotency: TO2→TO3 doesn't advance the task status (both legs are
    // DELIVERING), so a re-fired TO2 FINISHED event still matches this task.
    // If TO3 already exists, this is a duplicate — bail before creating it
    // again (openTCS would reject the repeated name with ObjectExistsException).
    if (task.metadata?.to3Name) {
      this.logger.debug(
        `Task ${task.id}: TO3 already created — ignoring duplicate TO2 finished`,
      );
      return;
    }

    const cargo = await this.cargoOf(task);
    if (!cargo) {
      this.logger.warn(`Task ${task.id} has no cargo — marking FAILED`);
      await this.transportTask.changeStatus(task, TaskStatus.FAILED);
      return;
    }

    const vehicle = this.vehicleOf(task);
    if (!vehicle) {
      this.logger.warn(
        `Task ${task.id} has no assigned vehicle — marking FAILED`,
      );
      await this.transportTask.changeStatus(task, TaskStatus.FAILED);
      return;
    }

    // Commit the concrete drop-off slot now (barrier): the vehicle is parked at
    // the zone's approach head, so occupancy reflects physical reality and the
    // fill order stays correct on one-way lanes. Idempotent — a re-fired event
    // reuses the already-committed slot.
    let slot = cargo.destinationLocationName;
    if (!slot) {
      slot = await this.commitDropoffSlot(cargo);
      if (!slot) {
        this.logger.warn(
          `Task ${task.id}: no drop-off slot available at barrier — marking FAILED`,
        );
        await this.transportTask.changeStatus(task, TaskStatus.FAILED);
        return;
      }
    }

    const to3Name = `DROPOFF-${randomUUID()}`;
    const created = await this.createNextOrder(
      to3Name,
      slot,
      'DROP_OFF',
      vehicle,
      { taskId: task.id, leg: 'DROPOFF' },
    );
    if (!created) return;

    // No status change here — the task stays DELIVERING until drop-off lands.
    task.metadata = { ...task.metadata, to3Name };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: created ${to3Name} (drop-off at ${slot})`,
    );
  }

  /**
   * Atomically pick + reserve a concrete drop-off slot for a seat-reserved cargo.
   * A per-zone advisory lock serializes concurrent barriers so two vehicles never
   * commit the same slot; findSlot reads committed occupancy only (reserved
   * cargos with a null slot don't consume a specific slot). Returns the slot
   * name, or null when the zone is full / misconfigured.
   */
  private async commitDropoffSlot(cargo: CargoEntity): Promise<string | null> {
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
      return null;
    }

    return this.dataSource.transaction(async (manager) => {
      // Held until the transaction commits, so the next barrier's findSlot sees
      // this cargo's committed slot. (findSlot itself reads via its own repo at
      // READ COMMITTED — safe because the lock serializes commit order.)
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [cargo.destinationZoneId],
      );
      const repo = manager.getRepository(CargoEntity);
      // Re-read under the lock: a concurrent / re-fired barrier may have already
      // committed a slot for this cargo — reuse it instead of double-assigning.
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
    await this.transportTask.changeStatus(task, TaskStatus.DELIVERY_COMPLETED);

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
    locationName: string,
    operation: string,
    vehicle: string,
    props: { taskId: string; leg: TaskLeg },
  ): Promise<boolean> {
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName, operation }],
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

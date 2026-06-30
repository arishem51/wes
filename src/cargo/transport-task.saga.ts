import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
  TaskMetadata,
  TASK_META,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { FMS_EVENTS, FmsTransportOrderFinishedEvent } from './domain/events';

/**
 * Drives a transport task through its physical legs in openTCS:
 *
 *   TO1 (PICK_UP)  done → create TO2, task → DELIVERING
 *   TO2 (approach) done → create TO3 (still DELIVERING)
 *   TO3 (DROP_OFF) done → task → DELIVERY_COMPLETED, cargo → DELIVERED
 *
 * The kernel only tells us "order X FINISHED"; the prefix of X decides
 * which leg just completed.
 */
@Injectable()
export class TransportTaskSaga {
  private readonly logger = new Logger(TransportTaskSaga.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
  ) {}

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_FINISHED)
  async onTransportOrderFinished(
    event: FmsTransportOrderFinishedEvent,
  ): Promise<void> {
    const { orderName } = event;
    if (orderName.startsWith('TO1-')) {
      await this.onPickupFinished(orderName);
    } else if (orderName.startsWith('TO2-')) {
      await this.onApproachFinished(orderName);
    } else if (orderName.startsWith('TO3-')) {
      await this.onDropOffFinished(orderName);
    }
  }

  private async onPickupFinished(toName: string): Promise<void> {
    const task = await this.findTaskByOrder(
      TASK_META.TO1_NAME,
      toName,
      TaskStatus.PICKING_UP,
    );
    if (!task) return;

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

    const to2Name = `TO2-${task.id}`;
    const created = await this.createNextOrder(
      to2Name,
      approachLocationName,
      'NOP',
      vehicle,
    );
    if (!created) return;

    task.metadata = { ...task.metadata, to2Name };
    await this.transportTask.changeStatus(task, TaskStatus.DELIVERING);
    this.logger.log(
      `Task ${task.id} → DELIVERING, created ${to2Name} (approach)`,
    );
  }

  private async onApproachFinished(toName: string): Promise<void> {
    const task = await this.findTaskByOrder(
      TASK_META.TO2_NAME,
      toName,
      TaskStatus.DELIVERING,
    );
    if (!task) return;

    const cargo = await this.cargoOf(task);
    if (!cargo?.destinationLocationName) {
      this.logger.warn(
        `Task ${task.id} missing destination location — marking FAILED`,
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

    const to3Name = `TO3-${task.id}`;
    const created = await this.createNextOrder(
      to3Name,
      cargo.destinationLocationName,
      'DROP_OFF',
      vehicle,
    );
    if (!created) return;

    // No status change here — the task stays DELIVERING until drop-off lands.
    task.metadata = { ...task.metadata, to3Name };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: created ${to3Name} (drop-off at ${cargo.destinationLocationName})`,
    );
  }

  private async onDropOffFinished(toName: string): Promise<void> {
    const task = await this.findTaskByOrder(
      TASK_META.TO3_NAME,
      toName,
      TaskStatus.DELIVERING,
    );
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

  private findTaskByOrder(
    metaKey: keyof TaskMetadata,
    orderName: string,
    requiredStatus: TaskStatus,
  ): Promise<TransportTaskEntity | null> {
    return this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${metaKey}' = :name`, { name: orderName })
      .andWhere('t.status = :status', { status: requiredStatus })
      .getOne()
      .then((task) => {
        if (!task) {
          this.logger.debug(
            `No ${requiredStatus} task found for order "${orderName}"`,
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
  ): Promise<boolean> {
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName, operation }],
        vehicle,
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

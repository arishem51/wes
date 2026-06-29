import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
  TASK_META,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import { FMS_EVENTS, FmsTransportOrderFinishedEvent } from './domain/events';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly dispatchScheduler: DispatchSchedulerService,
  ) {}

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_FINISHED)
  async onTransportOrderFinished(
    event: FmsTransportOrderFinishedEvent,
  ): Promise<void> {
    const { orderName } = event;
    if (orderName.startsWith('TO1-')) {
      await this.onPickUpToFinished(orderName);
      this.dispatchScheduler.schedule();
    } else if (orderName.startsWith('TO2-')) {
      await this.onApproachToFinished(orderName);
    } else if (orderName.startsWith('TO3-')) {
      await this.onDropOffToFinished(orderName);
    }
  }

  private async onPickUpToFinished(toName: string): Promise<void> {
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.TO1_NAME}' = :name`, { name: toName })
      .andWhere('t.status = :status', { status: TaskStatus.PICKING_UP })
      .getOne();

    if (!task) {
      this.logger.debug(`No PICKING_UP task found for TO1 "${toName}"`);
      return;
    }

    const approachLocationName = task.metadata?.approachLocationName;
    if (!approachLocationName) {
      this.logger.warn(
        `Task ${task.id} has no approach location — marking FAILED`,
      );
      task.status = TaskStatus.FAILED;
      await this.taskRepo.save(task);
      return;
    }

    const to2Name = `TO2-${task.id}`;
    const vehicle = task.metadata?.assignedVehicleName ?? 'Vehicle-0001';

    try {
      await this.kernelApi.createTransportOrder(
        to2Name,
        [{ locationName: approachLocationName, operation: 'NOP' }],
        vehicle,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create TO2 for task ${task.id}: ${(err as Error).message}`,
      );
      return;
    }

    task.status = TaskStatus.DELIVERING;
    task.metadata = { ...task.metadata, to2Name };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id} → DELIVERING, created ${to2Name} (approach)`,
    );
  }

  private async onApproachToFinished(toName: string): Promise<void> {
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.TO2_NAME}' = :name`, { name: toName })
      .andWhere('t.status = :status', { status: TaskStatus.DELIVERING })
      .getOne();

    if (!task) {
      this.logger.debug(`No DELIVERING task found for TO2 "${toName}"`);
      return;
    }

    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;

    if (!cargo?.destinationLocationName) {
      this.logger.warn(
        `Task ${task.id} missing destination location — marking FAILED`,
      );
      task.status = TaskStatus.FAILED;
      await this.taskRepo.save(task);
      return;
    }

    const to3Name = `TO3-${task.id}`;
    const vehicle = task.metadata?.assignedVehicleName ?? 'Vehicle-0001';

    try {
      await this.kernelApi.createTransportOrder(
        to3Name,
        [
          {
            locationName: cargo.destinationLocationName,
            operation: 'DROP_OFF',
          },
        ],
        vehicle,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create TO3 for task ${task.id}: ${(err as Error).message}`,
      );
      return;
    }

    task.metadata = { ...task.metadata, to3Name };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: created ${to3Name} (drop-off at ${cargo.destinationLocationName})`,
    );
  }

  private async onDropOffToFinished(toName: string): Promise<void> {
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.TO3_NAME}' = :name`, { name: toName })
      .andWhere('t.status = :status', { status: TaskStatus.DELIVERING })
      .getOne();

    if (!task) {
      this.logger.debug(`No DELIVERING task found for TO3 "${toName}"`);
      return;
    }

    task.status = TaskStatus.DELIVERY_COMPLETED;
    task.completedAt = new Date();
    await this.taskRepo.save(task);

    if (task.cargoId) {
      await this.cargoRepo.update(task.cargoId, {
        status: CargoStatus.DELIVERED,
      });
    }
    this.logger.log(`Task ${task.id} → DELIVERY_COMPLETED`);
    this.dispatchScheduler.schedule();
  }
}

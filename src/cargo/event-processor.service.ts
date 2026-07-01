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
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import {
  FMS_EVENTS,
  FmsTransportOrderFinishedEvent,
  FmsTransportOrderFailedEvent,
} from './domain/events';

/**
 * Completes a task when its merged OpenTCS order (PICK_UP + DROP_OFF) finishes.
 * With one order per task the whole delivery is a single "order finished" event.
 */
@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly dispatchScheduler: DispatchSchedulerService,
  ) {}

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_FINISHED)
  async onTransportOrderFinished(
    event: FmsTransportOrderFinishedEvent,
  ): Promise<void> {
    if (!event.orderName.startsWith('TASK-')) {
      return;
    }
    await this.onTaskOrderFinished(event.orderName);
  }

  private async onTaskOrderFinished(orderName: string): Promise<void> {
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.ORDER_NAME}' = :name`, { name: orderName })
      .andWhere('t.status = :status', { status: TaskStatus.PICKING_UP })
      .getOne();

    if (!task) {
      this.logger.debug(`No in-progress task for order "${orderName}"`);
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
    this.logger.log(`Task ${task.id} → DELIVERY_COMPLETED (${orderName})`);
    // A vehicle just freed up — nudge the scheduler to dispatch waiting tasks.
    this.dispatchScheduler.schedule();
  }

  /**
   * Recovery: the kernel could not route/execute the order (e.g. destination is
   * an isolated point). Fail the task and release the cargo so nothing stays
   * stuck at PICKING_UP forever.
   */
  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_FAILED)
  async onTransportOrderFailed(
    event: FmsTransportOrderFailedEvent,
  ): Promise<void> {
    if (!event.orderName.startsWith('TASK-')) {
      return;
    }
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.ORDER_NAME}' = :name`, {
        name: event.orderName,
      })
      .andWhere('t.status = :status', { status: TaskStatus.PICKING_UP })
      .getOne();

    if (!task) {
      return;
    }

    task.status = TaskStatus.FAILED;
    await this.taskRepo.save(task);
    if (task.cargoId) {
      await this.cargoRepo.update(task.cargoId, {
        status: CargoStatus.CANCELLED,
      });
    }
    this.logger.warn(
      `Task ${task.id} → FAILED (${event.orderName}: ${event.reason})`,
    );
    this.dispatchScheduler.schedule();
  }
}

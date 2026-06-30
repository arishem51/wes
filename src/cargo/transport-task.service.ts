import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { TransportTaskStateMachine } from './domain/transport-task.state-machine';
import {
  TRANSPORT_TASK_EVENTS,
  TransportTaskCreatedEvent,
  TransportTaskStatusChangedEvent,
  TransportTaskCompletedEvent,
  TransportTaskFailedEvent,
} from './domain/events';

/**
 * Owns the persistence + event side of the transport task lifecycle.
 * Every status change goes through `changeStatus`, so transitions are
 * validated, persisted, and announced in exactly one place.
 */
@Injectable()
export class TransportTaskService {
  private readonly logger = new Logger(TransportTaskService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  publishCreated(task: TransportTaskEntity): void {
    this.logger.debug(
      `publishCreated: emitting ${TRANSPORT_TASK_EVENTS.CREATED} for task ${task.id}`,
    );
    this.eventEmitter.emit(
      TRANSPORT_TASK_EVENTS.CREATED,
      new TransportTaskCreatedEvent(task.id, task.cargoId),
    );
  }

  async changeStatus(
    task: TransportTaskEntity,
    to: TaskStatus,
  ): Promise<TransportTaskEntity> {
    const from = task.status;
    TransportTaskStateMachine.transition(task, to);
    const saved = await this.taskRepo.save(task);

    this.eventEmitter.emit(
      TRANSPORT_TASK_EVENTS.STATUS_CHANGED,
      new TransportTaskStatusChangedEvent(saved.id, from, to, saved.cargoId),
    );

    if (to === TaskStatus.DELIVERY_COMPLETED) {
      this.eventEmitter.emit(
        TRANSPORT_TASK_EVENTS.COMPLETED,
        new TransportTaskCompletedEvent(saved.id, saved.cargoId),
      );
    } else if (to === TaskStatus.FAILED) {
      this.eventEmitter.emit(
        TRANSPORT_TASK_EVENTS.FAILED,
        new TransportTaskFailedEvent(saved.id, saved.cargoId),
      );
    }

    return saved;
  }
}

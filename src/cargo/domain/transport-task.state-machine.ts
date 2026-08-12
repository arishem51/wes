import {
  TaskStatus,
  TransportTaskEntity,
} from '../entities/transport-task.entity';

export class InvalidTransportTaskTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid transport task transition: ${from} → ${to}`);
    this.name = 'InvalidTransportTaskTransitionError';
  }
}

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.CREATED]: [
    TaskStatus.READY_TO_ASSIGN,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
    TaskStatus.FAILED,
  ],
  [TaskStatus.READY_TO_ASSIGN]: [
    TaskStatus.PICKING_UP,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
    TaskStatus.FAILED,
  ],
  [TaskStatus.BLOCKED]: [
    TaskStatus.READY_TO_ASSIGN,
    TaskStatus.CANCELLED,
    TaskStatus.FAILED,
  ],
  [TaskStatus.PICKING_UP]: [
    TaskStatus.DELIVERING,
    TaskStatus.READY_TO_ASSIGN,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
    TaskStatus.FAILED,
  ],
  [TaskStatus.DELIVERING]: [
    TaskStatus.DELIVERY_COMPLETED,
    TaskStatus.CANCELLED,
    TaskStatus.FAILED,
  ],
  [TaskStatus.DELIVERY_COMPLETED]: [],
  [TaskStatus.CANCELLED]: [],
  [TaskStatus.FAILED]: [],
};

export class TransportTaskStateMachine {
  static canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  static isCancellable(status: TaskStatus): boolean {
    return this.canTransition(status, TaskStatus.CANCELLED);
  }

  static transition(task: TransportTaskEntity, to: TaskStatus): void {
    if (!this.canTransition(task.status, to)) {
      throw new InvalidTransportTaskTransitionError(task.status, to);
    }
    task.status = to;
  }
}

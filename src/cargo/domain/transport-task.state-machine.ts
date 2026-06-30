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

/**
 * The single source of truth for the transport task lifecycle.
 * Read this table to know the whole flow — nothing else assigns `task.status`.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.CREATED]: [
    TaskStatus.READY_TO_ASSIGN,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.READY_TO_ASSIGN]: [
    TaskStatus.PICKING_UP,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
  ],
  // BLOCKED → READY_TO_ASSIGN when the blocking cargo leaves its pickup point.
  [TaskStatus.BLOCKED]: [TaskStatus.READY_TO_ASSIGN, TaskStatus.CANCELLED],
  [TaskStatus.PICKING_UP]: [
    TaskStatus.DELIVERING,
    // Preempt: an outer same-lane cargo appeared; withdraw TO1 and re-block.
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

  /** The ONLY place that mutates `task.status`. */
  static transition(task: TransportTaskEntity, to: TaskStatus): void {
    if (!this.canTransition(task.status, to)) {
      throw new InvalidTransportTaskTransitionError(task.status, to);
    }
    task.status = to;
  }
}

import { TaskStatus } from '../entities/transport-task.entity';

export const TRANSPORT_TASK_EVENTS = {
  CREATED: 'transport-task.created',
  STATUS_CHANGED: 'transport-task.status-changed',
  COMPLETED: 'transport-task.completed',
  FAILED: 'transport-task.failed',
} as const;

export const FMS_EVENTS = {
  TRANSPORT_ORDER_FINISHED: 'fms.transport-order.finished',
  VEHICLE_AVAILABLE: 'fms.vehicle.available',
} as const;

/**
 * The physical leg an openTCS order represents. Carried on the order as a
 * property (see ORDER_PROP) so the saga routes finished orders by leg + task id
 * instead of parsing the order name — order names are opaque unique tokens.
 */
export type TaskLeg = 'PICKUP' | 'APPROACH' | 'DROPOFF';

/** openTCS transport-order property keys WES sets to correlate orders to tasks. */
export const ORDER_PROP = {
  TASK_ID: 'wes:taskId',
  LEG: 'wes:leg',
} as const;

export class TransportTaskCreatedEvent {
  constructor(
    readonly taskId: string,
    readonly cargoId: string | null,
  ) {}
}

export class TransportTaskStatusChangedEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatus,
    readonly cargoId: string | null,
  ) {}
}

export class TransportTaskCompletedEvent {
  constructor(
    readonly taskId: string,
    readonly cargoId: string | null,
  ) {}
}

export class TransportTaskFailedEvent {
  constructor(
    readonly taskId: string,
    readonly cargoId: string | null,
  ) {}
}

export class FmsTransportOrderFinishedEvent {
  constructor(
    readonly orderName: string,
    readonly taskId: string,
    readonly leg: TaskLeg,
  ) {}
}

export class FmsVehicleAvailableEvent {
  constructor(readonly vehicleName: string) {}
}

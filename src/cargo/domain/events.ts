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

/**
 * Prefix WES stamps on every park-order name. WES owns this name, so a vehicle's
 * order can be classified as a park order from the vehicle snapshot alone
 * (`transportOrder` starts with this) — no order fetch, and no unsafe inference
 * from "processing + no task" that could mistake a cargo order for a park order.
 * Cargo orders use the PICKUP-/APPROACH-/DROPOFF- prefixes instead.
 */
export const PARK_ORDER_PREFIX = 'PARK-';

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

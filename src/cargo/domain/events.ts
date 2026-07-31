import { TaskStatus } from '../entities/transport-task.entity';
import { ORDER_TYPE } from './transport-order-name';

export const TRANSPORT_TASK_EVENTS = {
  CREATED: 'transport-task.created',
  STATUS_CHANGED: 'transport-task.status-changed',
  COMPLETED: 'transport-task.completed',
  FAILED: 'transport-task.failed',
} as const;

export const FMS_EVENTS = {
  TRANSPORT_ORDER_FINISHED: 'fms.transport-order.finished',
  VEHICLE_AVAILABLE: 'fms.vehicle.available',
  VEHICLE_ERROR_CHANGED: 'fms.vehicle.error-changed',
} as const;

export type TaskLeg = 'PICKUP' | 'APPROACH' | 'DROPOFF';

export const ORDER_PROP = {
  TASK_ID: 'wes:taskId',
  LEG: 'wes:leg',
} as const;

export const PARK_ORDER_PREFIX = `${ORDER_TYPE.PARK}-`;

export const CHARGE_ORDER_PREFIX = `${ORDER_TYPE.CHARGE}-`;

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

export type VehicleErrorChangeKind = 'RAISED' | 'CHANGED' | 'CLEARED';

export class FmsVehicleErrorChangedEvent {
  constructor(
    readonly vehicleName: string,
    readonly kind: VehicleErrorChangeKind,
    readonly fatal: string[],
    readonly warning: string[],
    readonly vehicleState: string,
    readonly pointName: string | null,
    readonly transportOrderName: string | null,
    readonly observedAt: string | null,
  ) {}
}

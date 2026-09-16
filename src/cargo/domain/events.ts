import { TaskStatus } from '../entities/transport-task.entity';

export const TRANSPORT_TASK_EVENTS = {
  CREATED: 'transport-task.created',
  STATUS_CHANGED: 'transport-task.status-changed',
  COMPLETED: 'transport-task.completed',
  FAILED: 'transport-task.failed',
  UPDATED: 'transport-task.updated',
} as const;

export const ZONE_EVENTS = {
  SLOT_RELEASED: 'zone.slot-released',
} as const;

export const FMS_EVENTS = {
  TRANSPORT_ORDER_FINISHED: 'fms.transport-order.finished',
  TRANSPORT_ORDER_LOST_NAVIGATION: 'fms.transport-order.lost-navigation',
  /** Any kernel transport order's state/drive-order signature changed — manual orders included,
   *  unlike the task-scoped events above. Drives the operating screen's live Order panel. */
  TRANSPORT_ORDER_CHANGED: 'fms.transport-order.changed',
  DROPOFF_UNLOADED: 'fms.transport-order.dropoff-unloaded',
  VEHICLE_AVAILABLE: 'fms.vehicle.available',
  VEHICLE_ERROR_CHANGED: 'fms.vehicle.error-changed',
  /** A different map record was just loaded into the kernel — every vehicle/order/cargo/area an
   *  operating client has cached belongs to the map that was just replaced. */
  MAP_LOADED: 'fms.map.loaded',
} as const;

export type TaskLeg = 'PICKUP' | 'APPROACH' | 'DROPOFF';

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

/** A task's metadata changed without a status transition (e.g. unloaded-at, soft-delete) —
 *  still needs to reach the same listeners a status change would, so the UI doesn't go stale. */
export class TransportTaskUpdatedEvent {
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

export class FmsTransportOrderLostNavigationEvent {
  constructor(
    readonly orderName: string,
    readonly taskId: string,
    readonly leg: TaskLeg,
    readonly vehicleName: string,
  ) {}
}

export class FmsDropOffUnloadedEvent {
  constructor(
    readonly orderName: string,
    readonly taskId: string,
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

export class FmsMapLoadedEvent {
  constructor(readonly mapRecordId: string) {}
}

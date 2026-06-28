import { TaskStatus } from '../entities/transport-task.entity';

export const TRANSPORT_TASK_EVENTS = {
  STATUS_CHANGED: 'transport-task.status-changed',
  COMPLETED: 'transport-task.completed',
  FAILED: 'transport-task.failed',
} as const;

export const FMS_EVENTS = {
  TRANSPORT_ORDER_FINISHED: 'fms.transport-order.finished',
  VEHICLE_AVAILABLE: 'fms.vehicle.available',
} as const;

export class TransportTaskStatusChangedEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatus,
    readonly cargoId: string | null,
  ) {}
}

export class FmsTransportOrderFinishedEvent {
  constructor(readonly orderName: string) {}
}

export class FmsVehicleAvailableEvent {
  constructor(readonly vehicleName: string) {}
}

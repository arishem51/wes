import { AgvEntity } from './entities/agv.entity';
import { VehicleErrorEventEntity } from './entities/vehicle-error-event.entity';
import { VehicleStateTransitionEntity } from '../opentcs/entities/vehicle-state-transition.entity';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';
import type {
  AgvAcceptanceStatus,
  AgvDto,
  AgvErrorEventDto,
  AgvKernelStatus,
  AgvStateChangeDto,
} from './dto/agvs.dto';

export function acceptanceStatusOf(agv: AgvEntity): AgvAcceptanceStatus {
  if (agv.isIgnored) return 'IGNORED';
  return agv.isDispatchEnabled ? 'ENABLED' : 'DISABLED';
}

export function resolveKernelStatus(
  kernelReachable: boolean,
  vehicle: KernelVehicleState | undefined,
): AgvKernelStatus {
  if (!kernelReachable) return 'unknown';
  if (!vehicle) return 'unreachable';
  return vehicle.integrationLevel === 'TO_BE_UTILIZED'
    ? 'connected'
    : 'reachable';
}

export function toAgvDto(
  agv: AgvEntity,
  kernelStatus: AgvKernelStatus,
): AgvDto {
  return {
    id: agv.id,
    code: agv.code,
    name: agv.name,
    model: agv.model,
    manufacturer: agv.manufacturer,
    serialNumber: agv.serialNumber,
    isDispatchEnabled: agv.isDispatchEnabled,
    isIgnored: agv.isIgnored,
    acceptanceStatus: acceptanceStatusOf(agv),
    criticalBatteryThreshold: agv.criticalBatteryThreshold,
    sufficientBatteryThreshold: agv.sufficientBatteryThreshold,
    initialPosition: agv.initialPosition,
    config: agv.config,
    createdAt: agv.createdAt,
    createdById: agv.createdById,
    kernelStatus,
  };
}

export function toAgvStateChangeDto(
  transition: VehicleStateTransitionEntity,
): AgvStateChangeDto {
  return {
    id: transition.id,
    vehicleName: transition.vehicleName,
    pointName: transition.pointName,
    procState: transition.procState,
    vehicleState: transition.vehicleState,
    orderName: transition.orderName,
    occurredAt: transition.occurredAt,
    observedAt: transition.observedAt,
  };
}

export function toAgvErrorEventDto(
  event: VehicleErrorEventEntity,
): AgvErrorEventDto {
  return {
    id: event.id,
    vehicleName: event.vehicleName,
    kind: event.kind,
    fatalErrorTypes: event.fatalErrorTypes,
    warningErrorTypes: event.warningErrorTypes,
    vehicleState: event.vehicleState,
    pointName: event.pointName,
    transportOrderName: event.transportOrderName,
    metadata: event.metadata,
    occurredAt: event.occurredAt,
    observedAt: event.observedAt,
  };
}

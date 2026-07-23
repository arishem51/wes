import { AgvEntity } from './entities/agv.entity';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import type {
  AgvAcceptanceStatus,
  AgvDto,
  AgvKernelStatus,
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

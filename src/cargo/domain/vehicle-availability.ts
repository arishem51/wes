import type { KernelVehicleState } from '../../opentcs/domain/kernel-model';
import { PARK_ORDER_PREFIX } from './events';

export function isFmsDispatchable(
  state: KernelVehicleState | undefined,
): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED' &&
    state.state !== 'CHARGING'
  );
}

export function isEnRouteToPark(
  state: KernelVehicleState | undefined,
): boolean {
  if (!state) return false;
  return (
    state.procState === 'PROCESSING_ORDER' &&
    state.integrationLevel === 'TO_BE_UTILIZED' &&
    (state.transportOrder?.startsWith(PARK_ORDER_PREFIX) ?? false)
  );
}

export function isIntegrated(state: KernelVehicleState | undefined): boolean {
  return state?.integrationLevel === 'TO_BE_UTILIZED';
}

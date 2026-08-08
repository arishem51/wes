export interface KernelVehicleErrors {
  fatal: string[];
  warning: string[];
}

export const VEHICLE_ERROR_PROPERTY_KEYS = {
  FATAL: 'vda5050:errors.fatal',
  WARNING: 'vda5050:errors.warning',
} as const;

export function emptyVehicleErrors(): KernelVehicleErrors {
  return { fatal: [], warning: [] };
}

export function parseVehicleErrorTypes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((errorType) => errorType.trim())
    .filter((errorType) => errorType.length > 0);
}

export function toVehicleErrors(
  properties: Record<string, string> | undefined,
): KernelVehicleErrors {
  return {
    fatal: parseVehicleErrorTypes(
      properties?.[VEHICLE_ERROR_PROPERTY_KEYS.FATAL],
    ),
    warning: parseVehicleErrorTypes(
      properties?.[VEHICLE_ERROR_PROPERTY_KEYS.WARNING],
    ),
  };
}

export function hasVehicleErrors(
  errors: KernelVehicleErrors | undefined,
): boolean {
  return (errors?.fatal.length ?? 0) > 0 || (errors?.warning.length ?? 0) > 0;
}

export function vehicleErrorsEqual(
  a: KernelVehicleErrors | undefined,
  b: KernelVehicleErrors | undefined,
): boolean {
  return (
    sameErrorTypes(a?.fatal, b?.fatal) && sameErrorTypes(a?.warning, b?.warning)
  );
}

function sameErrorTypes(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && a.every((errorType, i) => errorType === b[i]);
}

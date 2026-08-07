import type { VehicleTaskAssignment } from './dispatch.policy';

export interface CounterfactualRecord {
  readonly altVehicleName: string | null;
  readonly altDistanceToSource: number | null;
}

const NOT_COMPARABLE: CounterfactualRecord = {
  altVehicleName: null,
  altDistanceToSource: null,
};

export function summariseDistance(
  plan: readonly VehicleTaskAssignment[],
): string {
  const known = plan.flatMap(({ distance }) =>
    distance === null ? [] : [distance],
  );
  return `${known.reduce((sum, distance) => sum + distance, 0)}(${known.length}/${plan.length})`;
}

export function comparableCounterfactual(
  alternative: VehicleTaskAssignment | undefined,
  chosenVehicleName: string,
  isHeldTask: boolean,
  freeVehicleNames: ReadonlySet<string>,
  swapEnabled: boolean,
): CounterfactualRecord {
  if (!alternative) return NOT_COMPARABLE;

  const record = {
    altVehicleName: alternative.vehicle.name,
    altDistanceToSource: alternative.distance,
  };
  if (!swapEnabled) return record;

  const pricedTheSameWay =
    !isHeldTask &&
    freeVehicleNames.has(chosenVehicleName) &&
    freeVehicleNames.has(alternative.vehicle.name);
  return pricedTheSameWay ? record : NOT_COMPARABLE;
}

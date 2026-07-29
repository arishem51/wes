export interface ParkingPoint {
  readonly name: string;
  readonly priority: number | null;
}

export interface ParkVehicleCandidate {
  readonly name: string;
  readonly dispatchEnabled: boolean;
  readonly ignored: boolean;
  readonly idleAvailable: boolean;
  readonly onOrder: boolean;
  readonly hasActiveTask: boolean;
  readonly belowCritical: boolean;
  readonly currentPosition: string | null;
}

export function needsParking(
  c: ParkVehicleCandidate,
  parkingPointNames: ReadonlySet<string>,
  hasPendingWork: boolean,
): boolean {
  if (hasPendingWork) return false;
  return (
    c.dispatchEnabled &&
    !c.ignored &&
    c.idleAvailable &&
    !c.onOrder &&
    !c.hasActiveTask &&
    !c.belowCritical &&
    c.currentPosition !== null &&
    !parkingPointNames.has(c.currentPosition)
  );
}

export function pickParkingPoint(
  points: readonly ParkingPoint[],
  distanceByPoint: ReadonlyMap<string, number>,
  excluded: ReadonlySet<string>,
): ParkingPoint | null {
  return (
    points
      .filter((p) => !excluded.has(p.name))
      .map((p) => ({
        point: p,
        distance: distanceByPoint.get(p.name) ?? Infinity,
      }))
      .filter((x) => Number.isFinite(x.distance))
      .sort((a, b) => {
        const pa = a.point.priority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.point.priority ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.point.name.localeCompare(b.point.name);
      })[0]?.point ?? null
  );
}

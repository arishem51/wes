export interface ChargeLocation {
  readonly name: string;
  readonly points: readonly string[];
}

export interface ChargeVehicleCandidate {
  readonly name: string;
  readonly dispatchEnabled: boolean;
  readonly ignored: boolean;
  readonly idleAvailable: boolean;
  readonly charging: boolean;
  readonly onOrder: boolean;
  readonly currentPosition: string | null;
  readonly energyLevel: number;
  readonly criticalThreshold: number;
  readonly sufficientThreshold: number;
}

export function needsCharging(
  c: ChargeVehicleCandidate,
  chargePointNames: ReadonlySet<string>,
): boolean {
  return (
    c.dispatchEnabled &&
    !c.ignored &&
    c.idleAvailable &&
    !c.onOrder &&
    c.currentPosition !== null &&
    !chargePointNames.has(c.currentPosition) &&
    c.energyLevel <= c.criticalThreshold
  );
}

export function isReleaseCandidate(c: ChargeVehicleCandidate): boolean {
  return c.charging && !c.onOrder;
}

export function shouldRelease(
  c: ChargeVehicleCandidate,
  fullChargePct: number,
): boolean {
  return c.energyLevel >= fullChargePct;
}

export function pickChargeLocation(
  locations: readonly ChargeLocation[],
  distanceByPoint: ReadonlyMap<string, number>,
  freeSlots: ReadonlyMap<string, number>,
): ChargeLocation | null {
  return (
    locations
      .filter((loc) => (freeSlots.get(loc.name) ?? 0) > 0)
      .map((loc) => ({
        loc,
        distance: Math.min(
          ...loc.points.map((point) => distanceByPoint.get(point) ?? Infinity),
        ),
      }))
      .filter((x) => Number.isFinite(x.distance))
      .sort(
        (a, b) =>
          a.distance - b.distance || a.loc.name.localeCompare(b.loc.name),
      )[0]?.loc ?? null
  );
}

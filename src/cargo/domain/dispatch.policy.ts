/**
 * Pure fleet-eligibility rules (WF / ARCHITECTURE §6.1).
 *
 * A candidate is a flattened, framework-free view of one AGV combining its
 * WES registry config with its live FMS telemetry. Keeping this layer pure
 * (primitives only, no TypeORM/openTCS types) makes the dispatch rule a
 * single readable predicate that is trivial to unit-test.
 */
export interface VehicleCandidate {
  /** openTCS vehicle name (== AgvEntity.name). */
  readonly name: string;
  readonly dispatchEnabled: boolean;
  readonly ignored: boolean;
  /** FMS reports the vehicle integrated and idle/awaiting an order. */
  readonly available: boolean;
  /**
   * En route to (or sitting on) a WES-issued park/charge order with no cargo task
   * — dispatchable, but its order must be withdrawn before assigning. Lets a
   * vehicle already heading to park be pulled back for cargo the instant it lands.
   */
  readonly preemptibleParking: boolean;
  /** Order to withdraw when preempting this vehicle; null when not preemptible. */
  readonly parkOrderName: string | null;
  readonly energyLevel: number;
  readonly operationalThreshold: number;
  /** openTCS point the vehicle currently occupies, or null if not localized. */
  readonly currentPosition: string | null;
  /** Already carrying a PICKING_UP/DELIVERING task. */
  hasActiveTask: boolean;
}

export function isEligible(c: VehicleCandidate): boolean {
  return (
    c.dispatchEnabled &&
    !c.ignored &&
    (c.available || c.preemptibleParking) &&
    !c.hasActiveTask &&
    c.energyLevel > c.operationalThreshold
  );
}

/**
 * Deterministic fallback pick: the eligible vehicle with the lowest name.
 * Used when no distance data is available (plant model down, or the vehicle /
 * cargo has no known point). Determinism keeps behaviour predictable.
 */
export function pickVehicle(
  candidates: readonly VehicleCandidate[],
): VehicleCandidate | null {
  return (
    candidates
      .filter(isEligible)
      .sort((a, b) => a.name.localeCompare(b.name))[0] ?? null
  );
}

/**
 * Nearest-vehicle pick: the eligible vehicle with the smallest road-graph
 * distance from its current point to the task's pickup point (§6.1).
 * `distanceByPoint` maps a point name → Dijkstra distance from the pickup point.
 * A vehicle with no known position, or one whose point is unreachable, is absent
 * from the map and sorts last (Infinity). Ties (equal distance, or all unknown)
 * fall back to lowest-name so the pick stays deterministic.
 */
export function pickNearestVehicle(
  candidates: readonly VehicleCandidate[],
  distanceByPoint: ReadonlyMap<string, number>,
): VehicleCandidate | null {
  const costOf = (c: VehicleCandidate): number =>
    c.currentPosition
      ? (distanceByPoint.get(c.currentPosition) ?? Infinity)
      : Infinity;
  return (
    candidates.filter(isEligible).sort((a, b) => {
      const delta = costOf(a) - costOf(b);
      return delta !== 0 ? delta : a.name.localeCompare(b.name);
    })[0] ?? null
  );
}

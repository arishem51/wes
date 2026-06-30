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
  readonly energyLevel: number;
  readonly operationalThreshold: number;
  /** Already carrying a PICKING_UP/DELIVERING task. */
  hasActiveTask: boolean;
}

export function isEligible(c: VehicleCandidate): boolean {
  return (
    c.dispatchEnabled &&
    !c.ignored &&
    c.available &&
    !c.hasActiveTask &&
    c.energyLevel > c.operationalThreshold
  );
}

/**
 * Deterministic pick: the eligible vehicle with the lowest name.
 * Determinism keeps behaviour predictable and tests stable; a smarter
 * cost function can replace this single function later without touching
 * the engine.
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

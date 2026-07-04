/**
 * Pure idle-parking rules.
 *
 * A vehicle that has been idle with no cargo work is sent to a PARK_POSITION.
 * As with `dispatch.policy.ts`, this layer is framework-free (primitives only,
 * no TypeORM/openTCS types) so the rules are a couple of readable predicates
 * that unit-test without a DB or the kernel. The engine feeds live data in;
 * the policy decides who parks and where.
 */

/** A park destination: an openTCS PARK_POSITION point and its priority. */
export interface ParkingPoint {
  readonly name: string;
  /** Lower value = higher priority (openTCS convention). Null when unset. */
  readonly priority: number | null;
}

/** Flattened, framework-free view of one AGV for the parking decision. */
export interface ParkVehicleCandidate {
  /** openTCS vehicle name (== AgvEntity.name). */
  readonly name: string;
  readonly dispatchEnabled: boolean;
  readonly ignored: boolean;
  /** FMS reports the vehicle integrated and idle/awaiting an order. */
  readonly idleAvailable: boolean;
  /** Already processing some transport order (a park/charge order included). */
  readonly onOrder: boolean;
  /** Carrying a PICKING_UP/DELIVERING cargo task. */
  readonly hasActiveTask: boolean;
  /** openTCS point the vehicle currently occupies, or null if not localized. */
  readonly currentPosition: string | null;
}

/**
 * A vehicle should be sent to park when it is dispatch-enabled, idle, free of
 * any order or cargo task, localized, and not already standing on a park point —
 * AND there is no cargo waiting to be assigned. `hasPendingWork` is a fleet-wide
 * gate: while any task is still awaiting assignment, an idle vehicle stays put so
 * it can take that work, rather than parking only to be preempted moments later.
 * (A vehicle already en route to park is `onOrder`/not `idleAvailable`, so it is
 * excluded — this keeps the decision idempotent across reconcile ticks.)
 */
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
    c.currentPosition !== null &&
    !parkingPointNames.has(c.currentPosition)
  );
}

/**
 * Pick the best park point for a vehicle. openTCS convention: priority dominates
 * (lower first); among equal priority — including all-unset — the nearest by
 * road-graph distance wins, ties broken by name for determinism. Points that are
 * excluded (occupied, or already targeted this cycle) or unreachable (absent from
 * the distance map / Infinity) are dropped. Returns null when none qualify.
 *
 * `distanceByPoint` maps a point name → Dijkstra distance from the vehicle's
 * current point (built by the engine from the road graph).
 */
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

import { solveHungarian } from './hungarian';

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

/** A FIFO-ordered task and its road distances from the pickup point. */
export interface DispatchTaskCandidate {
  readonly taskId: string;
  /** Null when the plant model or the task's source point is unavailable. */
  readonly distanceByPoint: ReadonlyMap<string, number> | null;
}

export interface VehicleTaskAssignment {
  readonly taskId: string;
  readonly vehicle: VehicleCandidate;
  /** Real road distance, or null when this pair uses the fallback cost. */
  readonly distance: number | null;
}

/**
 * Build one globally optimal dispatch batch.
 *
 * Tasks are expected in FIFO order. Only the oldest N tasks are considered,
 * where N is the number of eligible vehicles, so global distance optimisation
 * cannot starve old work when the backlog is larger than the fleet. Vehicles
 * are sorted by name before solving, giving a stable fallback when distance
 * data is unavailable or tied.
 *
 * Unknown pairs receive a finite penalty larger than the maximum possible total
 * of a fully known batch. A graph-confirmed unreachable pair receives a second,
 * larger sentinel and is removed from the result. This makes the solver first
 * maximise feasible cardinality, then minimise unknown pairs and road distance.
 */
export function planVehicleAssignments(
  candidates: readonly VehicleCandidate[],
  tasks: readonly DispatchTaskCandidate[],
): VehicleTaskAssignment[] {
  const vehicles = uniqueEligibleVehicles(candidates);
  const selectedTasks = tasks.slice(0, vehicles.length);
  if (vehicles.length === 0 || selectedTasks.length === 0) return [];

  const pairs = selectedTasks.map((task) =>
    vehicles.map((vehicle) => evaluatePair(task, vehicle)),
  );
  const finiteDistances = pairs
    .flat()
    .flatMap((pair) => (pair.kind === 'reachable' ? [pair.distance] : []));
  const maxDistance = finiteDistances.reduce(
    (maximum, distance) => Math.max(maximum, distance),
    0,
  );
  const batchScale = selectedTasks.length + 1;
  const unknownCost = (maxDistance + 1) * batchScale;
  const unreachableCost = unknownCost * batchScale;

  if (!Number.isFinite(unreachableCost)) {
    throw new RangeError('Dispatch distance matrix exceeds numeric range');
  }

  const costMatrix = pairs.map((row) =>
    row.map((pair) => {
      if (pair.kind === 'reachable') return pair.distance;
      return pair.kind === 'unknown' ? unknownCost : unreachableCost;
    }),
  );
  const { assignment } = solveHungarian(costMatrix);

  return selectedTasks.flatMap((task, taskIndex) => {
    const vehicleIndex = assignment[taskIndex];
    const pair = pairs[taskIndex][vehicleIndex];
    return pair.kind === 'unreachable'
      ? []
      : [
          {
            taskId: task.taskId,
            vehicle: vehicles[vehicleIndex],
            distance: pair.kind === 'reachable' ? pair.distance : null,
          },
        ];
  });
}

/** Whether this task has at least one known-reachable or unknown fallback pair. */
export function hasDispatchableVehicle(
  candidates: readonly VehicleCandidate[],
  task: DispatchTaskCandidate,
): boolean {
  return uniqueEligibleVehicles(candidates).some(
    (vehicle) => evaluatePair(task, vehicle).kind !== 'unreachable',
  );
}

function uniqueEligibleVehicles(
  candidates: readonly VehicleCandidate[],
): VehicleCandidate[] {
  return (
    candidates
      .filter(isEligible)
      .sort((a, b) => a.name.localeCompare(b.name))
      // Vehicle name is the physical openTCS join key. Defensive de-duplication
      // prevents inconsistent registry rows from assigning one AGV twice.
      .filter(
        (vehicle, index, sorted) =>
          index === 0 || sorted[index - 1].name !== vehicle.name,
      )
  );
}

type PairEvaluation =
  | { readonly kind: 'reachable'; readonly distance: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unreachable' };

function evaluatePair(
  task: DispatchTaskCandidate,
  vehicle: VehicleCandidate,
): PairEvaluation {
  // No graph/source or no localized vehicle position means the route is
  // unknown, not impossible. Preserve the deterministic legacy fallback.
  if (!task.distanceByPoint || !vehicle.currentPosition) {
    return { kind: 'unknown' };
  }
  const distance = task.distanceByPoint.get(vehicle.currentPosition);
  return distance !== undefined && Number.isFinite(distance) && distance >= 0
    ? { kind: 'reachable', distance }
    : { kind: 'unreachable' };
}

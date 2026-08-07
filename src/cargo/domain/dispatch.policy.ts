import { batteryCost } from './dispatch-cost';
import { solveHungarian } from './hungarian';

export interface VehicleCandidate {
  readonly name: string;
  readonly dispatchEnabled: boolean;
  readonly ignored: boolean;
  readonly available: boolean;
  readonly preemptibleParking: boolean;
  readonly energyLevel: number;
  readonly criticalThreshold: number;
  readonly currentPosition: string | null;
  readonly inFlightPickupTaskId: string | null;
  hasActiveTask: boolean;
}

export interface SwapOptions {
  readonly enabled: boolean;
  readonly baseMm: number;
  readonly stepMm: number;
  readonly maxSwaps: number;
}

export const SWAP_DISABLED: SwapOptions = {
  enabled: false,
  baseMm: 0,
  stepMm: 0,
  maxSwaps: 0,
};

export function isEligible(c: VehicleCandidate): boolean {
  return (
    c.dispatchEnabled &&
    !c.ignored &&
    (c.available || c.preemptibleParking) &&
    !c.hasActiveTask &&
    c.energyLevel > c.criticalThreshold
  );
}

export function isSwapCandidate(c: VehicleCandidate): boolean {
  return (
    c.dispatchEnabled &&
    !c.ignored &&
    c.inFlightPickupTaskId !== null &&
    c.energyLevel > c.criticalThreshold
  );
}

export function pickVehicle(
  candidates: readonly VehicleCandidate[],
): VehicleCandidate | null {
  return (
    candidates
      .filter(isEligible)
      .sort((a, b) => a.name.localeCompare(b.name))[0] ?? null
  );
}

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

export interface DispatchTaskCandidate {
  readonly taskId: string;
  readonly distanceByPoint: ReadonlyMap<string, number> | null;
  readonly approachDistance?: number | null;
  readonly swapCount?: number;
  readonly pinned?: boolean;
}

export interface VehicleTaskAssignment {
  readonly taskId: string;
  readonly vehicle: VehicleCandidate;
  readonly distance: number | null;
}

export type DispatchMatcher = 'hungarian' | 'greedy';

export function planVehicleAssignments(
  candidates: readonly VehicleCandidate[],
  tasks: readonly DispatchTaskCandidate[],
  batteryWeight = 0,
  swap: SwapOptions = SWAP_DISABLED,
): VehicleTaskAssignment[] {
  const batch = buildBatch(candidates, tasks, batteryWeight, swap);
  if (!batch) return [];
  return toAssignments(batch, solveHungarian(batch.costMatrix).assignment);
}

export function planVehicleAssignmentsGreedy(
  candidates: readonly VehicleCandidate[],
  tasks: readonly DispatchTaskCandidate[],
  batteryWeight = 0,
  swap: SwapOptions = SWAP_DISABLED,
): VehicleTaskAssignment[] {
  const batch = buildBatch(candidates, tasks, batteryWeight, swap);
  if (!batch) return [];
  return toAssignments(batch, cheapestFreeVehiclePerTask(batch.costMatrix));
}

interface DispatchBatch {
  readonly vehicles: readonly VehicleCandidate[];
  readonly selectedTasks: readonly DispatchTaskCandidate[];
  readonly pairs: readonly (readonly PairEvaluation[])[];
  readonly costMatrix: readonly (readonly number[])[];
}

function loadedApproachDistance(task: DispatchTaskCandidate): number {
  const distance = task.approachDistance;
  return typeof distance === 'number' &&
    Number.isFinite(distance) &&
    distance > 0
    ? distance
    : 0;
}

function heldTaskIdOf(
  vehicle: VehicleCandidate,
  swap: SwapOptions,
): string | null {
  return swap.enabled && isSwapCandidate(vehicle)
    ? vehicle.inFlightPickupTaskId
    : null;
}

function isPinned(task: DispatchTaskCandidate, swap: SwapOptions): boolean {
  return (task.pinned ?? false) || (task.swapCount ?? 0) >= swap.maxSwaps;
}

function switchCost(task: DispatchTaskCandidate, swap: SwapOptions): number {
  return swap.baseMm + (task.swapCount ?? 0) * swap.stepMm;
}

function selectRows(
  tasks: readonly DispatchTaskCandidate[],
  vehicles: readonly VehicleCandidate[],
  incumbentByTaskId: ReadonlyMap<string, string>,
): DispatchTaskCandidate[] {
  const freeSlots = vehicles.filter(isEligible).length;
  const held: DispatchTaskCandidate[] = [];
  const queued: DispatchTaskCandidate[] = [];
  for (const task of tasks) {
    if (incumbentByTaskId.has(task.taskId)) held.push(task);
    else queued.push(task);
  }
  return [...held, ...queued.slice(0, freeSlots)];
}

function buildBatch(
  candidates: readonly VehicleCandidate[],
  tasks: readonly DispatchTaskCandidate[],
  batteryWeight: number,
  swap: SwapOptions,
): DispatchBatch | null {
  const vehicles = matchableVehicles(candidates, tasks, swap);
  if (vehicles.length === 0) return null;

  const incumbentByTaskId = new Map<string, string>();
  for (const vehicle of vehicles) {
    const heldTaskId = heldTaskIdOf(vehicle, swap);
    if (heldTaskId) incumbentByTaskId.set(heldTaskId, vehicle.name);
  }

  const selectedTasks = selectRows(tasks, vehicles, incumbentByTaskId);
  if (selectedTasks.length === 0) return null;

  const pairs = selectedTasks.map((task) =>
    vehicles.map((vehicle) =>
      evaluateBatchPair(task, vehicle, incumbentByTaskId, swap),
    ),
  );
  const reachableCosts = pairs.map((row, taskIndex) =>
    row.map((pair, vehicleIndex) => {
      if (pair.kind !== 'reachable') return null;
      const task = selectedTasks[taskIndex];
      const vehicle = vehicles[vehicleIndex];
      const weighted =
        batteryWeight <= 0
          ? pair.distance
          : batteryCost(
              pair.distance + loadedApproachDistance(task),
              vehicle.energyLevel,
              batteryWeight,
            );
      const incumbent = incumbentByTaskId.get(task.taskId);
      return incumbent && incumbent !== vehicle.name
        ? weighted + switchCost(task, swap)
        : weighted;
    }),
  );
  const maxCost = reachableCosts
    .flat()
    .reduce<number>(
      (maximum, cost) => (cost !== null ? Math.max(maximum, cost) : maximum),
      0,
    );
  const idleRowCount = swap.enabled
    ? Math.max(0, vehicles.length - selectedTasks.length)
    : 0;
  const batchScale = selectedTasks.length + idleRowCount + 1;
  const unknownCost = (maxCost + 1) * batchScale;
  const unreachableCost = unknownCost * batchScale;

  if (!Number.isFinite(unreachableCost)) {
    throw new RangeError('Dispatch distance matrix exceeds numeric range');
  }

  const idleRow = vehicles.map((vehicle) =>
    heldTaskIdOf(vehicle, swap) ? unreachableCost : 0,
  );
  const costMatrix = [
    ...pairs.map((row, taskIndex) =>
      row.map((pair, vehicleIndex) => {
        if (pair.kind === 'reachable') {
          return reachableCosts[taskIndex][vehicleIndex] as number;
        }
        return pair.kind === 'unknown' ? unknownCost : unreachableCost;
      }),
    ),
    ...Array.from({ length: idleRowCount }, () => idleRow),
  ];
  return { vehicles, selectedTasks, pairs, costMatrix };
}

function toAssignments(
  batch: DispatchBatch,
  assignment: readonly number[],
): VehicleTaskAssignment[] {
  return batch.selectedTasks.flatMap((task, taskIndex) => {
    const vehicleIndex = assignment[taskIndex];
    if (vehicleIndex < 0) return [];
    const pair = batch.pairs[taskIndex][vehicleIndex];
    if (pair.kind === 'unreachable') {
      return [];
    }
    return [
      {
        taskId: task.taskId,
        vehicle: batch.vehicles[vehicleIndex],
        distance: pair.kind === 'reachable' ? pair.distance : null,
      },
    ];
  });
}

function cheapestFreeVehiclePerTask(
  costMatrix: readonly (readonly number[])[],
): number[] {
  const taken = new Set<number>();
  return costMatrix.map((row) => {
    let chosen = -1;
    let chosenCost = Infinity;
    row.forEach((cost, vehicleIndex) => {
      if (taken.has(vehicleIndex) || cost >= chosenCost) return;
      chosen = vehicleIndex;
      chosenCost = cost;
    });
    if (chosen >= 0) taken.add(chosen);
    return chosen;
  });
}

export function hasDispatchableVehicle(
  candidates: readonly VehicleCandidate[],
  task: DispatchTaskCandidate,
  swap: SwapOptions = SWAP_DISABLED,
): boolean {
  return matchableVehicles(candidates, [task], swap).some(
    (vehicle) => evaluatePair(task, vehicle).kind !== 'unreachable',
  );
}

function matchableVehicles(
  candidates: readonly VehicleCandidate[],
  tasks: readonly DispatchTaskCandidate[],
  swap: SwapOptions,
): VehicleCandidate[] {
  const rowTaskIds = new Set(tasks.map((task) => task.taskId));
  return candidates
    .filter((vehicle) => {
      const heldTaskId = heldTaskIdOf(vehicle, swap);
      if (heldTaskId) return rowTaskIds.has(heldTaskId);
      return isEligible(vehicle);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (vehicle, index, sorted) =>
        index === 0 || sorted[index - 1].name !== vehicle.name,
    );
}

type PairEvaluation =
  | { readonly kind: 'reachable'; readonly distance: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unreachable' };

function evaluateBatchPair(
  task: DispatchTaskCandidate,
  vehicle: VehicleCandidate,
  incumbentByTaskId: ReadonlyMap<string, string>,
  swap: SwapOptions,
): PairEvaluation {
  const incumbent = incumbentByTaskId.get(task.taskId);
  if (incumbent && incumbent !== vehicle.name && isPinned(task, swap)) {
    return { kind: 'unreachable' };
  }
  return evaluatePair(task, vehicle);
}

function evaluatePair(
  task: DispatchTaskCandidate,
  vehicle: VehicleCandidate,
): PairEvaluation {
  const position = vehicle.currentPosition;
  if (!task.distanceByPoint || !position) {
    return { kind: 'unknown' };
  }
  const toSource = task.distanceByPoint.get(position);
  if (toSource === undefined || !Number.isFinite(toSource) || toSource < 0) {
    return { kind: 'unreachable' };
  }
  return { kind: 'reachable', distance: toSource };
}

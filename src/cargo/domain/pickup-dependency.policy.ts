/**
 * Pure pickup row-dependency rule (WF-02 / ARCHITECTURE §6.3).
 *
 * Physical constraint: an AGV cannot drive through a row. Within one lane a
 * cargo can only be picked once every cargo between it and the aisle has left
 * its source point. So a task is BLOCKED while any same-lane cargo that is
 * still sitting at its source point is closer to the aisle (smaller depth).
 *
 * Framework-free (primitives only) so the rule is a single readable predicate
 * that is trivial to unit-test. The mapping from tasks/zones/plant-model to
 * these candidates lives in PickupDependencyService.
 */
export interface PickupCandidate {
  /** Transport task id. */
  readonly taskId: string;
  /** Lane index (parallel to the aisle). Same lane → can block each other. */
  readonly laneKey: number;
  /** Depth band away from the aisle; smaller = closer to the aisle (outer). */
  readonly depthKey: number;
  /** Pickup location name, used to phrase the blocked reason. */
  readonly locationName: string;
}

/**
 * The candidate (if any) that blocks `target`: same lane, strictly closer to
 * the aisle. When several block it, the nearest-aisle one is reported.
 */
export function findBlocker(
  target: PickupCandidate,
  others: readonly PickupCandidate[],
): PickupCandidate | null {
  let blocker: PickupCandidate | null = null;
  for (const o of others) {
    if (o.taskId === target.taskId) continue;
    if (o.laneKey !== target.laneKey) continue;
    if (o.depthKey >= target.depthKey) continue;
    if (!blocker || o.depthKey < blocker.depthKey) blocker = o;
  }
  return blocker;
}

export function isBlocked(
  target: PickupCandidate,
  others: readonly PickupCandidate[],
): boolean {
  return findBlocker(target, others) !== null;
}

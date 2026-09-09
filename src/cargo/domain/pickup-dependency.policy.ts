/**
 * Pure pickup row-dependency rule (WF-02 / ARCHITECTURE §6.3).
 *
 * Physical constraint: an AGV cannot drive through a row. Within one lane a
 * cargo can only be picked once every cargo between it and the aisle has left
 * its source point AND the vehicle that picked it has driven back out of the
 * column. So a task is BLOCKED while any same-lane cargo closer to the aisle
 * (smaller depth) is either still sitting at its source point, or has been
 * picked up by a vehicle that still holds a resource inside the lane.
 *
 * Framework-free (primitives only) so the rule is a single readable predicate
 * that is trivial to unit-test. The mapping from tasks/zones/plant-model to
 * these candidates lives in PickupDependencyService.
 */

const PATH_RESOURCE_SEPARATOR = ' --- ';

export interface PickupCandidate {
  /** Transport task id. */
  readonly taskId: string;
  /** Lane index (parallel to the aisle). Same lane → can block each other. */
  readonly laneKey: number;
  /** Depth band away from the aisle; smaller = closer to the aisle (outer). */
  readonly depthKey: number;
  /** Pickup location name, used to phrase the blocked reason. */
  readonly locationName: string;
  /** True while this cargo is still sitting at its source point. */
  readonly atSource?: boolean;
  /** The vehicle that picked this cargo up, once it is past its source point. */
  readonly vehicleName?: string | null;
  /** True once that vehicle's allocated resources include a point outside the lane. */
  readonly vehicleLeftColumn?: boolean;
}

/**
 * True once a vehicle's allocated resources include at least one point that is
 * not part of the lane — i.e. it has grabbed a resource beyond the column and is
 * on its way out. Path resources (`A --- B`) are ignored, only point resources
 * count (ARCHITECTURE §6.3).
 */
export function hasLeftColumn(
  allocatedResources: readonly (readonly string[])[],
  lanePoints: ReadonlySet<string>,
): boolean {
  return allocatedResources
    .flat()
    .filter((resource) => !resource.includes(PATH_RESOURCE_SEPARATOR))
    .some((point) => !lanePoints.has(point));
}

/** A candidate that has been picked and whose vehicle is clear of the lane no longer blocks. */
function hasClearedColumn(candidate: PickupCandidate): boolean {
  return candidate.atSource === false && candidate.vehicleLeftColumn === true;
}

/**
 * The candidate (if any) that blocks `target`: same lane, strictly closer to
 * the aisle, and not yet clear of the lane. When several block it, the
 * nearest-aisle one is reported.
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
    if (hasClearedColumn(o)) continue;
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

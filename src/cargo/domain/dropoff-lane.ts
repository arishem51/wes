import type { ZoneOccupancy } from './zone-occupancy';
import {
  laneIndexOfTarget,
  nextLaneToFill,
  waitingTargetsFor,
  type ZoneLane,
  type ZoneSlot,
  type ZoneSlotLayout,
} from './zone-slot-layout';

export interface LaneSpot {
  readonly lane: ZoneLane;
  readonly depth: number;
}

export function laneSpotOf(
  layout: ZoneSlotLayout,
  pointName: string,
): LaneSpot | null {
  for (const lane of layout.lanes) {
    const depth = lane.axisPoints.indexOf(pointName);
    if (depth !== -1) return { lane, depth };
  }
  return null;
}

export function standsOnASlot(lane: ZoneLane, pointName: string): boolean {
  return lane.slots.some((slot) => slot.pointName === pointName);
}

export function deepestReachableCell(
  lane: ZoneLane,
  occupiedLocationNames: ReadonlySet<string>,
): ZoneSlot | null {
  let reachable = 0;
  for (const [index, slot] of lane.slots.entries()) {
    if (occupiedLocationNames.has(slot.locationName)) reachable = index + 1;
  }
  return lane.slots[reachable] ?? null;
}

export function serveOrder<T extends { readonly depth: number }>(
  spots: readonly T[],
): T[] {
  return [...spots].sort((a, b) => a.depth - b.depth);
}

export function whereToQueue(
  layout: ZoneSlotLayout,
  occupancy: ZoneOccupancy,
): string | null {
  const laneIndex = nextLaneToFill(layout, occupancy.activeCountByLane());
  if (laneIndex === null) return null;

  const lane = layout.lanes[laneIndex];
  const taken = occupancy.claimedTargets();
  const committed = occupancy.committedInLane(laneIndex);

  if (!committed) {
    return (
      lane.slots.find((slot) => !taken.has(slot.locationName))?.locationName ??
      null
    );
  }

  const committedPoint = lane.slots.find(
    (slot) => slot.locationName === committed,
  )?.pointName;
  if (!committedPoint) return null;

  return (
    waitingTargetsFor(lane, committedPoint).find(
      (target) => !taken.has(target),
    ) ?? null
  );
}

export function canKeepDrivingTo(
  layout: ZoneSlotLayout,
  heading: string,
  target: string,
): boolean {
  const headingLane = laneIndexOfTarget(layout, heading);
  const targetLane = laneIndexOfTarget(layout, target);
  if (headingLane === null || headingLane !== targetLane) return false;

  const lane = layout.lanes[headingLane];
  const headingDepth = axisIndexOf(lane, heading);
  const targetDepth = axisIndexOf(lane, target);
  if (headingDepth === -1 || targetDepth === -1) return false;

  return targetDepth <= headingDepth;
}

function axisIndexOf(lane: ZoneLane, target: string): number {
  const slot = lane.slots.find((cell) => cell.locationName === target);
  return lane.axisPoints.indexOf(slot ? slot.pointName : target);
}

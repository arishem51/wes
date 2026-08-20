import {
  computeEgressPoints,
  computeFeederPoints,
  hopsToExit,
  type PlantPath,
} from '../../zones/domain/zone-topology';
import {
  resolveLocationPoints,
  type PlantLocation,
} from '../../zones/domain/member-points';
import { DROPOFF_RETREAT_CELLS, behindChain } from './retreat-point';

export const MAX_COLUMN_LEAD = 3;

export interface PlantPointPosition {
  x: number;
  y: number;
}

export interface PlantPoint {
  name: string;
  position: PlantPointPosition;
}

export interface ZoneSlot {
  readonly locationName: string;
  readonly pointName: string;
}

export interface ZoneLane {
  readonly axis: number;
  readonly slots: readonly ZoneSlot[];
  readonly axisPoints: readonly string[];
}

export interface ZoneSlotLayout {
  readonly columns: readonly (readonly ZoneSlot[])[];
  readonly lanes: readonly ZoneLane[];
  readonly entryPoints: readonly string[];
  readonly memberPointNames: ReadonlySet<string>;
  readonly strandedLocationNames: readonly string[];
}

interface PositionedSlot extends ZoneSlot {
  readonly x: number;
  readonly y: number;
}

export function buildZoneSlotLayout(
  points: readonly PlantPoint[],
  paths: readonly PlantPath[],
  locations: readonly PlantLocation[],
  memberLocationNames: readonly string[],
): ZoneSlotLayout {
  const pointByLocation = resolveLocationPoints(locations, memberLocationNames);
  const memberPointNames = new Set(pointByLocation.values());
  const positionByPoint = new Map(
    points.map((point) => [point.name, point.position]),
  );

  const egress = computeEgressPoints(paths, memberPointNames);
  const hops = hopsToExit(paths, memberPointNames, egress);

  const positioned: PositionedSlot[] = [];
  const stranded: string[] = [];
  for (const locationName of memberLocationNames) {
    const pointName = pointByLocation.get(locationName);
    const position = pointName ? positionByPoint.get(pointName) : undefined;
    if (!pointName || !position || !hops.has(pointName)) {
      stranded.push(locationName);
      continue;
    }
    positioned.push({ locationName, pointName, x: position.x, y: position.y });
  }

  const lanes = inFlowOrder(
    groupIntoLanes(positioned),
    paths,
    memberPointNames,
    positioned,
  );
  return {
    columns: lanes.map((lane) => lane.map(bareSlot)),
    lanes: lanes.map((lane) => ({
      axis: lane[0].x,
      slots: lane.map(bareSlot),
      axisPoints: axisPointsOf(lane, points, paths),
    })),
    entryPoints: computeFeederPoints(paths, memberPointNames),
    memberPointNames,
    strandedLocationNames: stranded,
  };
}

function axisPointsOf(
  lane: readonly PositionedSlot[],
  points: readonly PlantPoint[],
  paths: readonly PlantPath[],
): string[] {
  const shallowest = lane[lane.length - 1];
  return [
    ...lane.map((slot) => slot.pointName),
    ...behindChain({ points, paths }, shallowest.pointName).slice(
      0,
      DROPOFF_RETREAT_CELLS,
    ),
  ];
}

export function nextLaneToFill(
  layout: ZoneSlotLayout,
  activeCountByLane: readonly number[],
): number | null {
  const eligible = eligibleColumns(activeCountByLane);
  const first = eligible.indexOf(true);
  if (first === -1) return null;

  for (let index = first; index < layout.lanes.length; index++) {
    if (activeCountByLane[index] < layout.lanes[index].slots.length) {
      return index;
    }
  }
  return null;
}

function waitingChainFor(lane: ZoneLane, committedPointName: string): string[] {
  const committed = lane.axisPoints.indexOf(committedPointName);
  if (committed === -1) return [];
  return [...lane.axisPoints.slice(committed + 1 + DROPOFF_RETREAT_CELLS)];
}

export function waitingTargetsFor(
  lane: ZoneLane,
  committedPointName: string,
): string[] {
  const slotNameOf = new Map(
    lane.slots.map((slot) => [slot.pointName, slot.locationName] as const),
  );
  return waitingChainFor(lane, committedPointName).map(
    (point) => slotNameOf.get(point) ?? point,
  );
}

function bareSlot({ locationName, pointName }: PositionedSlot): ZoneSlot {
  return { locationName, pointName };
}

function groupIntoLanes(slots: readonly PositionedSlot[]): PositionedSlot[][] {
  const byAxis = new Map<number, PositionedSlot[]>();
  for (const slot of slots) {
    const lane = byAxis.get(slot.x);
    if (lane) lane.push(slot);
    else byAxis.set(slot.x, [slot]);
  }

  return [...byAxis.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, lane]) => lane.sort((a, b) => a.y - b.y));
}

function crossLaneDirection(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
  slots: readonly PositionedSlot[],
): number {
  const xOf = new Map(slots.map((slot) => [slot.pointName, slot.x]));
  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest) continue;
    if (!memberPointNames.has(src) || !memberPointNames.has(dest)) continue;

    const from = xOf.get(src);
    const to = xOf.get(dest);
    if (from == null || to == null || from === to) continue;
    if (path.maxVelocity > 0) return Math.sign(to - from);
    if (path.maxReverseVelocity > 0) return Math.sign(from - to);
  }
  return 1;
}

function inFlowOrder(
  lanes: readonly (readonly PositionedSlot[])[],
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
  slots: readonly PositionedSlot[],
): (readonly PositionedSlot[])[] {
  return crossLaneDirection(paths, memberPointNames, slots) >= 0
    ? [...lanes]
    : [...lanes].reverse();
}

export function isSlotLocation(
  layout: ZoneSlotLayout,
  target: string,
): boolean {
  return layout.lanes.some((lane) =>
    lane.slots.some((slot) => slot.locationName === target),
  );
}

export function laneIndexOfTarget(
  layout: ZoneSlotLayout,
  target: string,
): number | null {
  const index = layout.lanes.findIndex(
    (lane) =>
      lane.slots.some((slot) => slot.locationName === target) ||
      lane.axisPoints.includes(target),
  );
  return index === -1 ? null : index;
}

export function usableSlotCount(layout: ZoneSlotLayout): number {
  return layout.columns.reduce((total, column) => total + column.length, 0);
}

export function laneOfPoint(
  layout: ZoneSlotLayout,
  pointName: string,
): ZoneLane | null {
  return (
    layout.lanes.find((lane) =>
      lane.slots.some((slot) => slot.pointName === pointName),
    ) ?? null
  );
}

export function laneOfLocation(
  layout: ZoneSlotLayout,
  locationName: string,
): ZoneLane | null {
  return (
    layout.lanes.find((lane) =>
      lane.slots.some((slot) => slot.locationName === locationName),
    ) ?? null
  );
}

export function pointNamesOfLocations(
  layout: ZoneSlotLayout,
  locationNames: ReadonlySet<string>,
): Set<string> {
  const pointNames = new Set<string>();
  for (const lane of layout.lanes) {
    for (const slot of lane.slots) {
      if (locationNames.has(slot.locationName)) pointNames.add(slot.pointName);
    }
  }
  return pointNames;
}

export function columnIndexOfPoint(
  layout: ZoneSlotLayout,
  pointName: string,
): number | null {
  const index = layout.columns.findIndex((column) =>
    column.some((slot) => slot.pointName === pointName),
  );
  return index === -1 ? null : index;
}

export function columnLocationNames(
  layout: ZoneSlotLayout,
  columnIndex: number,
): ReadonlySet<string> {
  return new Set(
    (layout.columns[columnIndex] ?? []).map((slot) => slot.locationName),
  );
}

export function rankSlots(
  layout: ZoneSlotLayout,
  unavailableLocationNames: ReadonlySet<string>,
  activeCountByLane?: readonly number[],
): ZoneSlot[] {
  const taken = new Set(unavailableLocationNames);
  const filled = activeCountByLane
    ? [...activeCountByLane]
    : layout.columns.map(
        (column) =>
          column.filter((slot) => taken.has(slot.locationName)).length,
      );

  const fillOrder: ZoneSlot[] = [];
  for (;;) {
    const next = nextSlotToFill(layout, taken, filled);
    if (!next) return fillOrder;
    fillOrder.push(next.slot);
    taken.add(next.slot.locationName);
    filled[next.lane]++;
  }
}

function nextSlotToFill(
  layout: ZoneSlotLayout,
  taken: ReadonlySet<string>,
  filled: readonly number[],
): { slot: ZoneSlot; lane: number } | null {
  const { columns } = layout;
  if (columns.length === 0) return null;

  const eligible = eligibleColumns(filled);
  const firstEligible = eligible.indexOf(true);
  if (firstEligible === -1) return null;

  for (let index = firstEligible; index < columns.length; index++) {
    const empty = columns[index].find((slot) => !taken.has(slot.locationName));
    if (empty) return { slot: empty, lane: index };
  }
  return null;
}

function eligibleColumns(filled: readonly number[]): boolean[] {
  const eligible = new Array<boolean>(filled.length).fill(false);
  eligible[filled.length - 1] = true;
  for (let index = filled.length - 2; index >= 0; index--) {
    eligible[index] =
      eligible[index + 1] &&
      filled[index] - filled[index + 1] < MAX_COLUMN_LEAD;
  }
  return eligible;
}

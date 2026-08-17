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

export interface ZoneSlotLayout {
  readonly columns: readonly (readonly ZoneSlot[])[];
  readonly entryPoints: readonly string[];
  readonly memberPointNames: ReadonlySet<string>;
  readonly strandedLocationNames: readonly string[];
}

interface KeyedSlot extends ZoneSlot {
  readonly columnKey: number;
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

  const keyed: KeyedSlot[] = [];
  const stranded: string[] = [];
  for (const locationName of memberLocationNames) {
    const pointName = pointByLocation.get(locationName);
    const position = pointName ? positionByPoint.get(pointName) : undefined;
    const columnKey = pointName ? hops.get(pointName) : undefined;
    if (!pointName || !position || columnKey == null) {
      stranded.push(locationName);
      continue;
    }
    keyed.push({
      locationName,
      pointName,
      columnKey,
      x: position.x,
      y: position.y,
    });
  }

  return {
    columns: groupIntoColumns(keyed),
    entryPoints: computeFeederPoints(paths, memberPointNames),
    memberPointNames,
    strandedLocationNames: stranded,
  };
}

function groupIntoColumns(slots: readonly KeyedSlot[]): ZoneSlot[][] {
  const byColumnKey = new Map<number, KeyedSlot[]>();
  for (const slot of slots) {
    const column = byColumnKey.get(slot.columnKey);
    if (column) column.push(slot);
    else byColumnKey.set(slot.columnKey, [slot]);
  }

  return [...byColumnKey.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, column]) =>
      column
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(({ locationName, pointName }) => ({ locationName, pointName })),
    );
}

export function usableSlotCount(layout: ZoneSlotLayout): number {
  return layout.columns.reduce((total, column) => total + column.length, 0);
}

export function rankSlots(
  layout: ZoneSlotLayout,
  occupiedLocationNames: ReadonlySet<string>,
): ZoneSlot[] {
  const taken = new Set(occupiedLocationNames);
  const fillOrder: ZoneSlot[] = [];
  for (;;) {
    const next = nextSlotToFill(layout, taken);
    if (!next) return fillOrder;
    fillOrder.push(next);
    taken.add(next.locationName);
  }
}

function nextSlotToFill(
  layout: ZoneSlotLayout,
  taken: ReadonlySet<string>,
): ZoneSlot | null {
  const { columns } = layout;
  if (columns.length === 0) return null;

  const filled = columns.map(
    (column) => column.filter((slot) => taken.has(slot.locationName)).length,
  );
  const eligible = eligibleColumns(filled);

  const firstEligible = eligible.indexOf(true);
  if (firstEligible === -1) return null;

  for (let index = firstEligible; index < columns.length; index++) {
    const empty = columns[index].find((slot) => !taken.has(slot.locationName));
    if (empty) return empty;
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

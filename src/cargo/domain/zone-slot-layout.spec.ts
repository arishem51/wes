import {
  MAX_COLUMN_LEAD,
  buildZoneSlotLayout,
  columnIndexOfPoint,
  columnLocationNames,
  rankSlots,
  usableSlotCount,
  type PlantPoint,
  type ZoneSlotLayout,
} from './zone-slot-layout';
import type { PlantPath } from '../../zones/domain/zone-topology';
import type { PlantLocation } from '../../zones/domain/member-points';

const SHALLOW_X = 1000;
const DEEP_X = 2000;
const AISLE_X = 0;
const ROW_PITCH = -1000;

interface Rack {
  points: PlantPoint[];
  paths: PlantPath[];
  locations: PlantLocation[];
  memberLocationNames: string[];
  shallow: string[];
  deep: string[];
}

function twoWay(src: string, dest: string): PlantPath {
  return {
    srcPointName: src,
    destPointName: dest,
    maxVelocity: 1,
    maxReverseVelocity: 1,
  };
}

function oneWay(src: string, dest: string): PlantPath {
  return {
    srcPointName: src,
    destPointName: dest,
    maxVelocity: 1,
    maxReverseVelocity: 0,
  };
}

function rack(rows: number): Rack {
  const points: PlantPoint[] = [
    { name: 'entry-shallow', position: { x: SHALLOW_X, y: 0 } },
    { name: 'entry-deep', position: { x: DEEP_X, y: 0 } },
  ];
  const paths: PlantPath[] = [];
  const shallow: string[] = [];
  const deep: string[] = [];

  for (let row = 1; row <= rows; row++) {
    const y = row * ROW_PITCH;
    const shallowPoint = `S${row}`;
    const deepPoint = `D${row}`;
    const aislePoint = `A${row}`;
    shallow.push(shallowPoint);
    deep.push(deepPoint);
    points.push(
      { name: shallowPoint, position: { x: SHALLOW_X, y } },
      { name: deepPoint, position: { x: DEEP_X, y } },
      { name: aislePoint, position: { x: AISLE_X, y } },
    );
    paths.push(
      oneWay(shallowPoint, aislePoint),
      twoWay(deepPoint, shallowPoint),
    );
    if (row === 1) {
      paths.push(
        twoWay('entry-shallow', shallowPoint),
        twoWay('entry-deep', deepPoint),
      );
    } else {
      paths.push(
        twoWay(shallow[row - 2], shallowPoint),
        twoWay(deep[row - 2], deepPoint),
      );
    }
  }

  const memberPoints = [...shallow, ...deep];
  return {
    points,
    paths,
    locations: memberPoints.map((point) => ({
      name: `location_${point}`,
      links: [{ pointName: point }],
    })),
    memberLocationNames: memberPoints.map((point) => `location_${point}`),
    shallow,
    deep,
  };
}

function layoutOf(built: Rack): ZoneSlotLayout {
  return buildZoneSlotLayout(
    built.points,
    built.paths,
    built.locations,
    built.memberLocationNames,
  );
}

function fillOrder(layout: ZoneSlotLayout): string[] {
  return rankSlots(layout, new Set()).map((slot) => slot.pointName);
}

describe('buildZoneSlotLayout', () => {
  it('separates the rack into a deep and a shallow column, deep first', () => {
    const layout = layoutOf(rack(4));

    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0].map((s) => s.pointName)).toEqual([
      'D4',
      'D3',
      'D2',
    ]);
  });

  it('keeps the row that has its own way out with the shallow column', () => {
    const layout = layoutOf(rack(4));

    expect(layout.columns[1].map((s) => s.pointName)).toEqual([
      'S4',
      'S3',
      'S2',
      'S1',
      'D1',
    ]);
  });

  it('orders each column from the far end of the rack towards the entrance', () => {
    const layout = layoutOf(rack(4));

    expect(layout.columns[0].map((s) => s.pointName)).toEqual([
      'D4',
      'D3',
      'D2',
    ]);
  });

  it('reports the entrances of the rack as its commit gates', () => {
    const layout = layoutOf(rack(4));

    expect([...layout.entryPoints].sort()).toEqual(['D1', 'S1']);
  });

  it('drops a slot that cannot reach the exit instead of offering it', () => {
    const built = rack(3);
    built.points.push({ name: 'orphan', position: { x: 9000, y: 9000 } });
    built.locations.push({
      name: 'location_orphan',
      links: [{ pointName: 'orphan' }],
    });
    built.memberLocationNames.push('location_orphan');

    const layout = layoutOf(built);

    expect(layout.strandedLocationNames).toEqual(['location_orphan']);
    expect(usableSlotCount(layout)).toBe(6);
  });
});

describe('columnIndexOfPoint', () => {
  it('tells which column a vehicle standing on a slot is in', () => {
    const layout = layoutOf(rack(4));

    expect(columnIndexOfPoint(layout, 'D3')).toBe(0);
    expect(columnIndexOfPoint(layout, 'S3')).toBe(1);
  });

  it('reports no column for a point outside the rack', () => {
    const layout = layoutOf(rack(4));

    expect(columnIndexOfPoint(layout, 'A2')).toBeNull();
  });

  it('lists the slots a vehicle may still take without leaving its column', () => {
    const layout = layoutOf(rack(4));

    expect([...columnLocationNames(layout, 0)].sort()).toEqual([
      'location_D2',
      'location_D3',
      'location_D4',
    ]);
    expect(columnLocationNames(layout, 9).size).toBe(0);
  });
});

describe('rankSlots', () => {
  it('offers every slot that is not occupied', () => {
    const layout = layoutOf(rack(4));

    expect(rankSlots(layout, new Set())).toHaveLength(8);
    expect(
      rankSlots(layout, new Set(['location_D4', 'location_S4'])),
    ).toHaveLength(6);
  });

  it('starts at the far end of the deep column', () => {
    expect(fillOrder(layoutOf(rack(4))).slice(0, 3)).toEqual([
      'D4',
      'D3',
      'D2',
    ]);
  });

  it('never lets the deep column lead the shallow one by more than MAX_COLUMN_LEAD', () => {
    const layout = layoutOf(rack(8));
    const deep = new Set(layout.columns[0].map((slot) => slot.pointName));

    let deepFilled = 0;
    let shallowFilled = 0;
    let widestLead = 0;
    for (const point of fillOrder(layout)) {
      if (deep.has(point)) deepFilled++;
      else shallowFilled++;
      widestLead = Math.max(widestLead, deepFilled - shallowFilled);
    }

    expect(widestLead).toBe(MAX_COLUMN_LEAD);
  });

  it('falls back to the shallow column once the deep one is full', () => {
    const layout = layoutOf(rack(3));
    const allDeepTaken = new Set(
      layout.columns[0].map((slot) => slot.locationName),
    );

    expect(rankSlots(layout, allDeepTaken).map((s) => s.pointName)).toEqual([
      'S3',
      'S2',
      'S1',
      'D1',
    ]);
  });

  it('resumes the cascade from the slots that are already occupied', () => {
    const built = rack(8);
    const layout = layoutOf(built);
    const deepHeadStart = new Set(
      ['D8', 'D7', 'D6'].map((point) => `location_${point}`),
    );

    expect(rankSlots(layout, deepHeadStart)[0].pointName).toBe('S8');
  });
});

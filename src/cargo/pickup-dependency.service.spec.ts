import { PickupDependencyService } from './pickup-dependency.service';
import { TaskStatus } from './entities/transport-task.entity';

const OUTER = 'location_0100';
const INNER = 'location_0101';

function task(id: string, cargoId: string) {
  return { id, cargoId, status: TaskStatus.CREATED } as never;
}

function makeService(
  geometry: Map<string, { laneKey: number; depthKey: number }> | null,
) {
  const tasks = [task('t-outer', 'c-outer'), task('t-inner', 'c-inner')];
  const cargos = [
    {
      id: 'c-outer',
      sourceZoneId: 'zone-1',
      sourcePickupLocationName: OUTER,
    },
    {
      id: 'c-inner',
      sourceZoneId: 'zone-1',
      sourcePickupLocationName: INNER,
    },
  ];
  const taskRepo = { find: jest.fn().mockResolvedValue(tasks) };
  const cargoRepo = { find: jest.fn().mockResolvedValue(cargos) };
  const zoneRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'zone-1', name: 'khu a' }),
  };
  const zoneGeometry = {
    computeMemberAxes: jest.fn().mockResolvedValue(geometry),
  };
  return new PickupDependencyService(
    taskRepo as never,
    cargoRepo as never,
    zoneRepo as never,
    zoneGeometry as never,
  );
}

const LANE_GEOMETRY = new Map([
  [OUTER, { laneKey: 0, depthKey: 1000 }],
  [INNER, { laneKey: 0, depthKey: 2000 }],
]);

describe('PickupDependencyService', () => {
  it('blocks the inner cargo while the outer one is still at its source', async () => {
    const decisions = await makeService(LANE_GEOMETRY).evaluate();

    expect(decisions.find((d) => d.task.id === 't-inner')?.blocked).toBe(true);
    expect(decisions.find((d) => d.task.id === 't-outer')?.blocked).toBe(false);
  });

  it('holds every task in the zone when the geometry cannot be computed', async () => {
    const decisions = await makeService(null).evaluate();

    expect(decisions).toHaveLength(0);
  });
});

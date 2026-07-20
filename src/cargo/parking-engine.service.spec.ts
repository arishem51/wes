import { ParkingEngineService } from './parking-engine.service';
import { buildRoadGraph } from './domain/routing';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import type { AgvEntity } from '../agvs/entities/agv.entity';

const DELAY = 10_000;

const agv = (name: string): AgvEntity =>
  ({ name, isDispatchEnabled: true, isIgnored: false }) as AgvEntity;

const idleAt = (position: string): KernelVehicleState =>
  ({
    procState: 'IDLE',
    integrationLevel: 'TO_BE_UTILIZED',
    transportOrder: null,
    currentPosition: position,
  }) as KernelVehicleState;

const twoWay = (from: string, to: string, length: number) => ({
  from,
  to,
  length,
  maxVelocity: 1,
  maxReverseVelocity: 1,
});

const graph = buildRoadGraph([
  twoWay('P1', 'PARK-1', 1),
  twoWay('P3', 'PARK-1', 1),
  twoWay('PARK-1', 'PARK-2', 1),
  twoWay('PARK-2', 'P2', 1),
]);

function setup(
  states: Record<string, KernelVehicleState>,
  agvs: AgvEntity[],
  delayMs?: number,
) {
  const taskRepo = {
    count: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockResolvedValue([]),
  };
  const agvRepo = { find: jest.fn().mockResolvedValue(agvs) };
  const kernelApi = {
    getParkingPoints: jest.fn().mockResolvedValue([
      { name: 'PARK-1', priority: null },
      { name: 'PARK-2', priority: null },
    ]),
    createTransportOrder: jest.fn().mockResolvedValue(undefined),
  };
  const vehicleStore = { get: jest.fn((n: string) => states[n]) };
  const routing = { getRoadGraph: jest.fn().mockResolvedValue(graph) };
  const svc = withParkIdleDelay(
    delayMs,
    () =>
      new ParkingEngineService(
        taskRepo as never,
        agvRepo as never,
        kernelApi as never,
        vehicleStore as never,
        routing as never,
      ),
  );
  return { svc, taskRepo, kernelApi, states };
}

function withParkIdleDelay<T>(delayMs: number | undefined, build: () => T): T {
  const previous = process.env.PARK_IDLE_DELAY_MS;
  if (delayMs === undefined) delete process.env.PARK_IDLE_DELAY_MS;
  else process.env.PARK_IDLE_DELAY_MS = String(delayMs);
  try {
    return build();
  } finally {
    if (previous === undefined) delete process.env.PARK_IDLE_DELAY_MS;
    else process.env.PARK_IDLE_DELAY_MS = previous;
  }
}

describe('ParkingEngineService', () => {
  let nowSpy: jest.SpyInstance;
  let now = 1_000;
  beforeEach(() => {
    now = 1_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('parks an idle vehicle on the first cycle that sees it', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('P1') }, [agv('V1')]);

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^PARK-/),
      [{ locationName: 'PARK-1', operation: 'MOVE' }],
      'V1',
      { 'wes:leg': 'PARK' },
    );
  });

  it('holds a vehicle back until a configured delay elapses', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('P1') }, [agv('V1')], DELAY);

    await svc.run(); // t=1000 — clock starts, must not park yet
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();

    now += DELAY - 1;
    await svc.run(); // still under the delay
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();

    now += 2; // now past the delay
    await svc.run();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
  });

  it('does not park while cargo is waiting to be assigned', async () => {
    const { svc, taskRepo, kernelApi } = setup({ V1: idleAt('P1') }, [
      agv('V1'),
    ]);
    taskRepo.count.mockResolvedValue(1); // a READY_TO_ASSIGN task exists

    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('does not re-park a vehicle already standing on a park point', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('PARK-1') }, [agv('V1')]);

    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('sends two ready vehicles to two distinct park points (in one cycle)', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('P1'), V2: idleAt('P2') }, [
      agv('V1'),
      agv('V2'),
    ]);

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    const dests = kernelApi.createTransportOrder.mock.calls.map(
      (c: unknown[]) => (c[1] as { locationName: string }[])[0].locationName,
    );
    expect(new Set(dests).size).toBe(2); // distinct points, no collision
  });

  it('reserves an in-flight park point so a later vehicle avoids it (cross-cycle)', async () => {
    const states: Record<string, KernelVehicleState> = { V1: idleAt('P1') };
    const { svc, kernelApi } = setup(states, [agv('V1'), agv('V2')]);

    await svc.run(); // V1 parks → PARK-1 (nearest to P1)
    const [orderName, dest] = kernelApi.createTransportOrder.mock.calls[0] as [
      string,
      { locationName: string }[],
    ];
    expect(dest[0].locationName).toBe('PARK-1');

    // V1 is now en route on that park order; V2 appears idle at P3, whose own
    // nearest point is the PARK-1 that V1 has reserved.
    states.V1 = {
      procState: 'PROCESSING_ORDER',
      integrationLevel: 'TO_BE_UTILIZED',
      transportOrder: orderName,
      currentPosition: 'P1',
    } as KernelVehicleState;
    states.V2 = idleAt('P3');

    now += 1;
    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    const secondDest = (
      kernelApi.createTransportOrder.mock.calls[1][1] as {
        locationName: string;
      }[]
    )[0].locationName;
    expect(secondDest).toBe('PARK-2');
  });
});

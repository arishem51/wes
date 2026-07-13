import { ParkingEngineService } from './parking-engine.service';
import { buildRoadGraph } from './domain/routing';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import type { AgvEntity } from '../agvs/entities/agv.entity';

const DELAY = 10_000; // matches PARK_IDLE_DELAY_MS default

const agv = (name: string): AgvEntity =>
  ({ name, isDispatchEnabled: true, isIgnored: false }) as AgvEntity;

const idleAt = (position: string): KernelVehicleState =>
  ({
    procState: 'IDLE',
    integrationLevel: 'TO_BE_UTILIZED',
    transportOrder: null,
    currentPosition: position,
  }) as KernelVehicleState;

// A small connected graph: P1—PARK-1—PARK-2—P2 (unit edges), so each vehicle's
// nearest park point differs.
const graph = buildRoadGraph([
  { from: 'P1', to: 'PARK-1', length: 1, maxReverseVelocity: 1 },
  { from: 'PARK-1', to: 'PARK-2', length: 1, maxReverseVelocity: 1 },
  { from: 'PARK-2', to: 'P2', length: 1, maxReverseVelocity: 1 },
]);

function setup(states: Record<string, KernelVehicleState>, agvs: AgvEntity[]) {
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
  const svc = new ParkingEngineService(
    taskRepo as never,
    agvRepo as never,
    kernelApi as never,
    vehicleStore as never,
    routing as never,
  );
  return { svc, taskRepo, kernelApi, states };
}

describe('ParkingEngineService', () => {
  let nowSpy: jest.SpyInstance;
  let now = 1_000;
  beforeEach(() => {
    now = 1_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('parks an idle vehicle only after the delay elapses', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('P1') }, [agv('V1')]);

    await svc.run(); // t=1000 — clock starts, must not park yet
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();

    now += DELAY - 1;
    await svc.run(); // still under the delay
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();

    now += 2; // now past the delay
    await svc.run();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^PARK-/),
      [{ locationName: 'PARK-1', operation: 'MOVE' }],
      'V1',
      { 'wes:leg': 'PARK' },
    );
  });

  it('does not park while cargo is waiting to be assigned', async () => {
    const { svc, taskRepo, kernelApi } = setup({ V1: idleAt('P1') }, [
      agv('V1'),
    ]);
    taskRepo.count.mockResolvedValue(1); // a READY_TO_ASSIGN task exists

    await svc.run();
    now += DELAY + 1;
    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('does not re-park a vehicle already standing on a park point', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('PARK-1') }, [agv('V1')]);

    await svc.run();
    now += DELAY + 1;
    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('sends two ready vehicles to two distinct park points (in one cycle)', async () => {
    const { svc, kernelApi } = setup({ V1: idleAt('P1'), V2: idleAt('P2') }, [
      agv('V1'),
      agv('V2'),
    ]);

    await svc.run(); // start both clocks
    now += DELAY + 1;
    await svc.run(); // both park

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    const dests = kernelApi.createTransportOrder.mock.calls.map(
      (c: unknown[]) => (c[1] as { locationName: string }[])[0].locationName,
    );
    expect(new Set(dests).size).toBe(2); // distinct points, no collision
  });

  it('reserves an in-flight park point so a later vehicle avoids it (cross-cycle)', async () => {
    const states: Record<string, KernelVehicleState> = { V1: idleAt('P1') };
    const { svc, kernelApi } = setup(states, [agv('V1'), agv('V2')]);

    await svc.run(); // t=1000: V1 clock starts (V2 not present in store yet)
    now += DELAY + 1;
    await svc.run(); // V1 parks → PARK-1 (nearest to P1)
    const [orderName, dest] = kernelApi.createTransportOrder.mock.calls[0] as [
      string,
      { locationName: string }[],
    ];
    expect(dest[0].locationName).toBe('PARK-1');

    // V1 is now en route on that park order; V2 appears idle at P2.
    states.V1 = {
      procState: 'PROCESSING_ORDER',
      integrationLevel: 'TO_BE_UTILIZED',
      transportOrder: orderName,
      currentPosition: 'P1',
    } as KernelVehicleState;
    states.V2 = idleAt('P2');

    now += 1; // start V2 clock
    await svc.run();
    now += DELAY + 1;
    await svc.run(); // V2 parks — PARK-1 is reserved for V1, so it must pick PARK-2

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    const secondDest = (
      kernelApi.createTransportOrder.mock.calls[1][1] as {
        locationName: string;
      }[]
    )[0].locationName;
    expect(secondDest).toBe('PARK-2');
  });
});

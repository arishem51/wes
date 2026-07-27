import type { Repository } from 'typeorm';
import { ParkingEngineService } from './parking-engine.service';
import { PointReservationStore } from './point-reservation.store';
import { buildRoadGraph } from './domain/routing';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { RoutingService } from './routing.service';
import { TransportTaskEntity } from './entities/transport-task.entity';
import type { AgvEntity } from '../agvs/entities/agv.entity';

const DELAY = 10_000;

const agv = (name: string): AgvEntity =>
  ({ name, isDispatchEnabled: true, isIgnored: false }) as AgvEntity;

const idleAt = (name: string, position: string): KernelVehicleState => ({
  name,
  state: 'IDLE',
  procState: 'IDLE',
  integrationLevel: 'TO_BE_UTILIZED',
  energyLevel: 100,
  paused: false,
  currentPosition: position,
  transportOrder: null,
});

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
  states: KernelVehicleState[],
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
    getChargeLocations: jest.fn().mockResolvedValue([]),
    createTransportOrder: jest.fn().mockResolvedValue({
      name: 'created',
      state: 'RAW',
      destinations: [],
    }),
  };
  const routing = { getRoadGraph: jest.fn().mockResolvedValue(graph) };

  const vehicleStore = new VehicleStateStore();
  for (const state of states) vehicleStore.set(state.name, state);
  const reservations = new PointReservationStore(vehicleStore);

  const svc = withParkIdleDelay(
    delayMs,
    () =>
      new ParkingEngineService(
        taskRepo as unknown as Repository<TransportTaskEntity>,
        agvRepo as unknown as Repository<AgvEntity>,
        kernelApi as unknown as KernelApiService,
        vehicleStore,
        routing as unknown as RoutingService,
        reservations,
      ),
  );
  return { svc, taskRepo, kernelApi, vehicleStore, reservations };
}

function parkDestination(createOrder: jest.Mock, index = 0): string {
  const destinations = createOrder.mock.calls[index][1] as {
    locationName: string;
  }[];
  return destinations[0].locationName;
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
    const { svc, kernelApi } = setup([idleAt('V1', 'P1')], [agv('V1')]);

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^PARK-V1-PARK-1-/),
      [{ locationName: 'PARK-1', operation: 'MOVE' }],
      'V1',
      { 'wes:leg': 'PARK' },
    );
  });

  it('holds a vehicle back until a configured delay elapses', async () => {
    const { svc, kernelApi } = setup([idleAt('V1', 'P1')], [agv('V1')], DELAY);

    await svc.run();
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();

    now += DELAY - 1;
    await svc.run();
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();

    now += 2;
    await svc.run();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
  });

  it('does not park while cargo is waiting to be assigned', async () => {
    const { svc, taskRepo, kernelApi } = setup(
      [idleAt('V1', 'P1')],
      [agv('V1')],
    );
    taskRepo.count.mockResolvedValue(1);

    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('does not re-park a vehicle already standing on a park point', async () => {
    const { svc, kernelApi } = setup([idleAt('V1', 'PARK-1')], [agv('V1')]);

    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('sends two ready vehicles to two distinct park points (in one cycle)', async () => {
    const { svc, kernelApi } = setup(
      [idleAt('V1', 'P1'), idleAt('V2', 'P2')],
      [agv('V1'), agv('V2')],
    );

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    expect(
      new Set([
        parkDestination(kernelApi.createTransportOrder, 0),
        parkDestination(kernelApi.createTransportOrder, 1),
      ]).size,
    ).toBe(2);
  });

  it('reads the target point out of another vehicle park order name', async () => {
    const enRoute: KernelVehicleState = {
      ...idleAt('V2', 'P2'),
      procState: 'PROCESSING_ORDER',
      transportOrder: `PARK-V2-PARK-1-0d4dd3a5-bfe5-4d90-8893-31ed8d12cae5`,
    };
    const { svc, kernelApi } = setup(
      [idleAt('V1', 'P1'), enRoute],
      [agv('V1'), agv('V2')],
    );

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
    expect(parkDestination(kernelApi.createTransportOrder)).toBe('PARK-2');
  });

  it('sees a vehicle standing on a park point even without an agv row', async () => {
    const { svc, kernelApi } = setup(
      [idleAt('V1', 'P1'), idleAt('UNREGISTERED', 'PARK-1')],
      [agv('V1')],
    );

    await svc.run();

    expect(parkDestination(kernelApi.createTransportOrder)).toBe('PARK-2');
  });

  it('releases the reservation when creating the park order fails', async () => {
    const { svc, kernelApi, reservations } = setup(
      [idleAt('V1', 'P1')],
      [agv('V1')],
    );
    kernelApi.createTransportOrder.mockRejectedValue(new Error('kernel down'));

    await svc.run();

    expect(reservations.has('V1')).toBe(false);
  });

  it('reserves an in-flight park point so a later vehicle avoids it (cross-cycle)', async () => {
    const { svc, kernelApi, vehicleStore } = setup(
      [idleAt('V1', 'P1')],
      [agv('V1'), agv('V2')],
    );

    await svc.run();
    const orderName = kernelApi.createTransportOrder.mock.calls[0][0] as string;
    expect(parkDestination(kernelApi.createTransportOrder)).toBe('PARK-1');

    vehicleStore.set('V1', {
      ...idleAt('V1', 'P1'),
      procState: 'PROCESSING_ORDER',
      transportOrder: orderName,
    });
    vehicleStore.set('V2', idleAt('V2', 'P3'));

    now += 1;
    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    expect(parkDestination(kernelApi.createTransportOrder, 1)).toBe('PARK-2');
  });
});

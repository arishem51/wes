import type { Repository } from 'typeorm';
import { ChargeEngineService } from './charge-engine.service';
import { ParkClaimStore } from './park-claim.store';
import { buildRoadGraph } from './domain/routing';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';
import { RoutingService } from './routing.service';
import { TransportTaskEntity } from './entities/transport-task.entity';
import type { AgvEntity } from '../agvs/entities/agv.entity';

const agv = (name: string): AgvEntity =>
  ({
    name,
    isDispatchEnabled: true,
    isIgnored: false,
    criticalBatteryThreshold: 20,
    sufficientBatteryThreshold: 40,
  }) as AgvEntity;

const flat = (name: string, position: string): KernelVehicleState => ({
  name,
  state: 'IDLE',
  procState: 'IDLE',
  integrationLevel: 'TO_BE_UTILIZED',
  energyLevel: 10,
  paused: false,
  currentPosition: position,
  transportOrder: null,
});

const charging = (name: string, position: string): KernelVehicleState => ({
  ...flat(name, position),
  state: 'CHARGING',
  energyLevel: 50,
});

const twoWay = (from: string, to: string, length: number) => ({
  from,
  to,
  length,
  maxVelocity: 1,
  maxReverseVelocity: 1,
});

const graph = buildRoadGraph([
  twoWay('P1', 'C1', 1),
  twoWay('P1', 'PARK-1', 1),
  twoWay('PARK-1', 'PARK-2', 1),
]);

async function setup(
  states: KernelVehicleState[],
  options: { kernelUnreachable?: boolean } = {},
) {
  const taskRepo = { find: jest.fn().mockResolvedValue([]) };
  const agvRepo = { find: jest.fn().mockResolvedValue([agv('V1')]) };
  const kernelApi = {
    getChargeLocations: jest
      .fn()
      .mockResolvedValue([{ name: 'CHG-1', points: ['C1'] }]),
    getParkingPoints: jest.fn().mockResolvedValue([
      { name: 'PARK-1', priority: null },
      { name: 'PARK-2', priority: null },
    ]),
    getTransportOrders: options.kernelUnreachable
      ? jest.fn().mockRejectedValue(new Error('kernel down'))
      : jest.fn().mockResolvedValue([]),
    getTransportOrderState: jest.fn().mockResolvedValue('BEING_PROCESSED'),
    createTransportOrder: jest.fn().mockResolvedValue({
      name: 'created',
      state: 'RAW',
      destinations: [],
    }),
    sendInstantAction: jest.fn().mockResolvedValue(undefined),
    chargeOperation: 'startCharging',
  };
  const routing = { getRoadGraph: jest.fn().mockResolvedValue(graph) };

  const vehicleStore = new VehicleStateStore();
  for (const state of states) vehicleStore.set(state.name, state);

  const parkClaims = new ParkClaimStore(
    vehicleStore,
    kernelApi as unknown as KernelApiService,
  );
  await parkClaims.onApplicationBootstrap();

  const svc = new ChargeEngineService(
    taskRepo as unknown as Repository<TransportTaskEntity>,
    agvRepo as unknown as Repository<AgvEntity>,
    kernelApi as unknown as KernelApiService,
    vehicleStore,
    routing as unknown as RoutingService,
    parkClaims,
  );
  return { svc, kernelApi, parkClaims };
}

function orderDestination(createOrder: jest.Mock): string {
  const destinations = createOrder.mock.calls[0][1] as {
    locationName: string;
  }[];
  return destinations[0].locationName;
}

describe('ChargeEngineService', () => {
  it('charges a flat vehicle even when the park claim ledger is unavailable', async () => {
    const { svc, kernelApi } = await setup([flat('V1', 'P1')], {
      kernelUnreachable: true,
    });

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^CHARGE-V1-CHG-1-/),
      [{ locationName: 'CHG-1', operation: 'startCharging' }],
      'V1',
      { 'wes:leg': 'CHARGE' },
    );
  });

  it('skips the no-slot park fallback while the park claim ledger is unavailable', async () => {
    const { svc, kernelApi } = await setup(
      [flat('V1', 'P1'), charging('V9', 'C1')],
      { kernelUnreachable: true },
    );

    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('parks a vehicle that finds no charge slot and records the claim', async () => {
    const { svc, kernelApi, parkClaims } = await setup([
      flat('V1', 'P1'),
      charging('V9', 'C1'),
    ]);

    await svc.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^PARK-V1-PARK-1-/),
      [{ locationName: 'PARK-1', operation: 'MOVE' }],
      'V1',
      { 'wes:leg': 'PARK' },
      { dispensable: true },
    );
    expect(parkClaims.get('V1')).toEqual({
      point: 'PARK-1',
      orderName: kernelApi.createTransportOrder.mock.calls[0][0],
    });
  });

  it('does not stack a park order on a vehicle that already holds a claim', async () => {
    const { svc, kernelApi, parkClaims } = await setup([
      flat('V1', 'P1'),
      charging('V9', 'C1'),
    ]);
    parkClaims.claim('V1', 'PARK-1', 'PARK-V1-PARK-1-existing');

    await svc.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  it('keeps the fallback off a park point another vehicle has claimed', async () => {
    const { svc, kernelApi, parkClaims } = await setup([
      flat('V1', 'P1'),
      charging('V9', 'C1'),
    ]);
    parkClaims.claim('V2', 'PARK-1', 'PARK-V2-PARK-1-existing');

    await svc.run();

    expect(orderDestination(kernelApi.createTransportOrder)).toBe('PARK-2');
  });
});

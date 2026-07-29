import { AssignmentEngineService } from './assignment-engine.service';
import { ParkClaimStore } from './park-claim.store';
import { TaskStatus } from './entities/transport-task.entity';

const stub = <T>(value: unknown): T => value as T;

const QUEUED_PARK_ORDER = 'PARK-V1-1002-queued';
const ATTACHED_PARK_ORDER = 'PARK-abc';

describe('AssignmentEngineService park orders', () => {
  function build() {
    const task = {
      id: 't1',
      cargoId: 'c1',
      status: TaskStatus.READY_TO_ASSIGN,
      metadata: {},
      createdAt: new Date(),
    };
    const cargo = {
      id: 'c1',
      sourcePickupLocationName: 'LOC-1',
      sourcePointName: null,
    };
    const parkingVehicle = {
      procState: 'PROCESSING_ORDER',
      integrationLevel: 'TO_BE_UTILIZED',
      transportOrder: ATTACHED_PARK_ORDER,
      currentPosition: 'P1',
      energyLevel: 80,
    };

    const taskRepo = {
      find: jest
        .fn()
        .mockImplementation((opts: { where?: { status?: unknown } }) =>
          opts?.where?.status === TaskStatus.READY_TO_ASSIGN
            ? Promise.resolve([task])
            : Promise.resolve([]),
        ),
    };
    const cargoRepo = { findOne: jest.fn().mockResolvedValue(cargo) };
    const agvRepo = {
      find: jest.fn().mockResolvedValue([
        {
          name: 'V1',
          isDispatchEnabled: true,
          isIgnored: false,
          criticalBatteryThreshold: 20,
        },
      ]),
    };
    const kernelApi = {
      withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
      createTransportOrder: jest.fn().mockResolvedValue(undefined),
      getLiveParkOrders: jest.fn().mockResolvedValue([]),
      loadOperation: 'PICK_UP',
    };
    const vehicleStore = { get: jest.fn().mockReturnValue(parkingVehicle) };
    const parkClaims = new ParkClaimStore(stub(vehicleStore), stub(kernelApi));
    const transportTask = {
      changeStatus: jest.fn().mockResolvedValue(undefined),
    };
    const pickupDependency = { isBlocked: jest.fn().mockResolvedValue(false) };
    const routing = { getReverseRoadGraph: jest.fn().mockResolvedValue(null) };
    const dispatchPolicy = {
      getActiveWeights: jest.fn().mockResolvedValue(null),
    };
    const zoneRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const approachPoint = {
      feederPointsOf: jest.fn().mockResolvedValue([]),
    };

    const svc = new AssignmentEngineService(
      stub(taskRepo),
      stub(cargoRepo),
      stub(agvRepo),
      stub(zoneRepo),
      stub(kernelApi),
      stub(vehicleStore),
      stub(transportTask),
      stub(pickupDependency),
      stub(routing),
      stub(approachPoint),
      stub(dispatchPolicy),
    );
    return { svc, kernelApi, transportTask, vehicleStore, parkClaims };
  }

  function makeIdle(vehicleStore: { get: jest.Mock }): void {
    vehicleStore.get.mockReturnValue({
      procState: 'IDLE',
      integrationLevel: 'TO_BE_UTILIZED',
      transportOrder: null,
      currentPosition: 'P1',
      energyLevel: 80,
    });
  }

  it('assigns a vehicle en route to park without withdrawing its park order', async () => {
    const { svc, kernelApi, transportTask } = build();

    await svc.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
    expect(kernelApi.createTransportOrder).toHaveBeenCalledWith(
      expect.stringMatching(/^PICKUP-V1-LOC-1-/),
      [{ locationName: 'LOC-1', operation: 'PICK_UP' }],
      'V1',
      expect.objectContaining({ 'wes:leg': 'PICKUP' }),
    );
    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      TaskStatus.PICKING_UP,
      expect.anything(),
    );
  });

  it('does not withdraw anything for a plain idle (non-parking) vehicle', async () => {
    const { svc, kernelApi, vehicleStore } = build();
    makeIdle(vehicleStore);

    await svc.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
  });

  it('leaves a queued park order the vehicle snapshot cannot see to the kernel', async () => {
    const { svc, kernelApi, vehicleStore, parkClaims } = build();
    makeIdle(vehicleStore);
    parkClaims.claim('V1', '1002', QUEUED_PARK_ORDER);

    await svc.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(kernelApi.getLiveParkOrders).not.toHaveBeenCalled();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
  });

  it('keeps the park claim so the point stays reserved until the kernel retires the order', async () => {
    const { svc, parkClaims } = build();
    parkClaims.claim('V1', '1002', ATTACHED_PARK_ORDER);

    await svc.run();

    expect(parkClaims.get('V1')).toEqual({
      point: '1002',
      orderName: ATTACHED_PARK_ORDER,
    });
  });

  it('leaves another vehicle claim alone while assigning', async () => {
    const { svc, parkClaims } = build();
    parkClaims.claim('V2', '1003', 'PARK-V2-1003-queued');

    await svc.run();

    expect(parkClaims.get('V2')).toEqual({
      point: '1003',
      orderName: 'PARK-V2-1003-queued',
    });
  });
});

import { AssignmentEngineService } from './assignment-engine.service';
import { TaskStatus } from './entities/transport-task.entity';

/**
 * Focused test for the preempt path: when the picked vehicle is en route to a
 * park order, `assign()` must withdraw that order BEFORE creating the pickup TO.
 */
describe('AssignmentEngineService preempt', () => {
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
      transportOrder: 'PARK-abc', // en route to park → preemptible
      currentPosition: 'P1',
      energyLevel: 80,
    };

    const taskRepo = {
      // run() asks for READY tasks; busyVehicleNames() asks for In([PICKING_UP,DELIVERING]).
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
          operationalBatteryThreshold: 20,
        },
      ]),
    };
    const kernelApi = {
      withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
      createTransportOrder: jest.fn().mockResolvedValue(undefined),
    };
    const vehicleStore = { get: jest.fn().mockReturnValue(parkingVehicle) };
    const transportTask = {
      changeStatus: jest.fn().mockResolvedValue(undefined),
    };
    const pickupDependency = { isBlocked: jest.fn().mockResolvedValue(false) };
    const routing = { getReverseRoadGraph: jest.fn().mockResolvedValue(null) };
    const dispatchPolicy = {
      getActiveWeights: jest.fn().mockResolvedValue(null),
    };

    const svc = new AssignmentEngineService(
      taskRepo as never,
      cargoRepo as never,
      agvRepo as never,
      kernelApi as never,
      vehicleStore as never,
      transportTask as never,
      pickupDependency as never,
      routing as never,
      dispatchPolicy as never,
    );
    return { svc, kernelApi, transportTask, vehicleStore };
  }

  it('withdraws the park order before creating the pickup order', async () => {
    const { svc, kernelApi, transportTask } = build();

    await svc.run();

    expect(kernelApi.withdrawTransportOrder).toHaveBeenCalledWith('PARK-abc');
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
    // Ordering: withdraw strictly before create.
    const withdrawOrder =
      kernelApi.withdrawTransportOrder.mock.invocationCallOrder[0];
    const createOrder =
      kernelApi.createTransportOrder.mock.invocationCallOrder[0];
    expect(withdrawOrder).toBeLessThan(createOrder);

    // And the task advances to PICKING_UP on that vehicle.
    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      TaskStatus.PICKING_UP,
      expect.anything(),
    );
  });

  it('does not withdraw anything for a plain idle (non-parking) vehicle', async () => {
    const { svc, kernelApi, vehicleStore } = build();
    // Make the vehicle a normal idle candidate instead of parking.
    vehicleStore.get.mockReturnValue({
      procState: 'IDLE',
      integrationLevel: 'TO_BE_UTILIZED',
      transportOrder: null,
      currentPosition: 'P1',
      energyLevel: 80,
    });

    await svc.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(1);
  });
});

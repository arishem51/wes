import { AssignmentEngineService } from './assignment-engine.service';
import { ORDER_PROP } from './domain/events';
import { buildRoadGraph } from './domain/routing';
import { TaskStatus } from './entities/transport-task.entity';

const twoWay = (from: string, to: string, length: number) => ({
  from,
  to,
  length,
  maxVelocity: 1,
  maxReverseVelocity: 1,
});

describe('AssignmentEngineService Hungarian dispatch', () => {
  function build(blockedTaskIds: ReadonlySet<string> = new Set()) {
    const tasks = [
      {
        id: 't1',
        cargoId: 'c1',
        status: TaskStatus.READY_TO_ASSIGN,
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 't2',
        cargoId: 'c2',
        status: TaskStatus.READY_TO_ASSIGN,
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:01Z'),
      },
      {
        id: 't3',
        cargoId: 'c3',
        status: TaskStatus.READY_TO_ASSIGN,
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:02Z'),
      },
    ];
    const cargos = new Map([
      [
        'c1',
        {
          id: 'c1',
          sourcePickupLocationName: 'LOC-1',
          sourcePointName: 'S1',
        },
      ],
      [
        'c2',
        {
          id: 'c2',
          sourcePickupLocationName: 'LOC-2',
          sourcePointName: 'S2',
        },
      ],
      [
        'c3',
        {
          id: 'c3',
          sourcePickupLocationName: 'LOC-3',
          sourcePointName: 'S1',
        },
      ],
    ]);

    const taskRepo = {
      find: jest
        .fn()
        .mockImplementation((opts: { where?: { status?: unknown } }) =>
          opts?.where?.status === TaskStatus.READY_TO_ASSIGN
            ? Promise.resolve(tasks)
            : Promise.resolve([]),
        ),
    };
    const cargoRepo = {
      findOne: jest
        .fn()
        .mockImplementation((opts: { where: { id: string } }) =>
          Promise.resolve(cargos.get(opts.where.id) ?? null),
        ),
    };
    const agvRepo = {
      find: jest.fn().mockResolvedValue([
        {
          name: 'V1',
          isDispatchEnabled: true,
          isIgnored: false,
          operationalBatteryThreshold: 20,
        },
        {
          name: 'V2',
          isDispatchEnabled: true,
          isIgnored: false,
          operationalBatteryThreshold: 20,
        },
      ]),
    };
    const kernelApi = {
      withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
      createTransportOrder: jest.fn().mockResolvedValue(undefined),
      loadOperation: 'PICK_UP',
      unloadOperation: 'DROP_OFF',
    };
    const states = new Map([
      [
        'V1',
        {
          procState: 'IDLE',
          integrationLevel: 'TO_BE_UTILIZED',
          transportOrder: null,
          currentPosition: 'S2',
          energyLevel: 80,
        },
      ],
      [
        'V2',
        {
          procState: 'IDLE',
          integrationLevel: 'TO_BE_UTILIZED',
          transportOrder: null,
          currentPosition: 'V2-POS',
          energyLevel: 80,
        },
      ],
    ]);
    const vehicleStore = {
      get: jest.fn().mockImplementation((name: string) => states.get(name)),
    };
    const transportTask = {
      changeStatus: jest.fn().mockResolvedValue(undefined),
    };
    const pickupDependency = {
      isBlocked: jest
        .fn()
        .mockImplementation((task: { id: string }) =>
          Promise.resolve(blockedTaskIds.has(task.id)),
        ),
      blockingCounts: jest.fn().mockResolvedValue(new Map<string, number>()),
    };
    const dispatchPolicy = {
      getActiveWeights: jest.fn().mockResolvedValue(null),
    };
    const routing = {
      getReverseRoadGraph: jest
        .fn()
        .mockResolvedValue(
          buildRoadGraph([twoWay('S2', 'S1', 4), twoWay('S1', 'V2-POS', 6)]),
        ),
    };

    const service = new AssignmentEngineService(
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
    return {
      service,
      agvRepo,
      cargos,
      dispatchPolicy,
      kernelApi,
      pickupDependency,
      routing,
      transportTask,
    };
  }

  it('dispatches the global minimum-cost pairing instead of the greedy pairing', async () => {
    const { service, kernelApi, transportTask } = build();

    await service.run();

    expect(kernelApi.createTransportOrder).toHaveBeenCalledTimes(2);
    expect(kernelApi.createTransportOrder).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^PICKUP-/),
      [{ locationName: 'LOC-1', operation: 'PICK_UP' }],
      'V2',
      { [ORDER_PROP.TASK_ID]: 't1', [ORDER_PROP.LEG]: 'PICKUP' },
    );
    expect(kernelApi.createTransportOrder).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^PICKUP-/),
      [{ locationName: 'LOC-2', operation: 'PICK_UP' }],
      'V1',
      { [ORDER_PROP.TASK_ID]: 't2', [ORDER_PROP.LEG]: 'PICKUP' },
    );
    expect(transportTask.changeStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 't1' }),
      TaskStatus.PICKING_UP,
      expect.objectContaining({
        context: expect.objectContaining({ distanceToSource: 6 }),
      }),
    );
    expect(transportTask.changeStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 't2' }),
      TaskStatus.PICKING_UP,
      expect.objectContaining({
        context: expect.objectContaining({ distanceToSource: 0 }),
      }),
    );
  });

  it('skips a blocked FIFO task and fills the batch with the next task', async () => {
    const { service, kernelApi } = build(new Set(['t1']));

    await service.run();

    const dispatchedTaskIds = kernelApi.createTransportOrder.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
    );
    expect(dispatchedTaskIds).toEqual(['t2', 't3']);
  });

  it('re-plans and backfills when a task becomes blocked after planning', async () => {
    const { service, kernelApi, pickupDependency } = build();
    const checks = new Map<string, number>();
    pickupDependency.isBlocked.mockImplementation((task: { id: string }) => {
      const count = (checks.get(task.id) ?? 0) + 1;
      checks.set(task.id, count);
      return Promise.resolve(task.id === 't1' && count === 2);
    });

    await service.run();

    const dispatchedTaskIds = kernelApi.createTransportOrder.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
    );
    expect(dispatchedTaskIds).toEqual(['t2', 't3']);
  });

  it('quarantines a failed vehicle but continues independent assignments', async () => {
    const { service, kernelApi, transportTask } = build();
    kernelApi.createTransportOrder.mockImplementation(
      (_name: string, _destinations: unknown, vehicleName: string) =>
        vehicleName === 'V2'
          ? Promise.reject(new Error('vehicle V2 rejected assignment'))
          : Promise.resolve(),
    );

    await service.run();

    expect(
      kernelApi.createTransportOrder.mock.calls.map(
        (call: unknown[]) => call[2],
      ),
    ).toEqual(['V2', 'V1']);
    expect(
      transportTask.changeStatus.mock.calls.map(
        (call: Array<{ id: string }>) => call[0].id,
      ),
    ).toEqual(['t2']);
  });

  it('defers a graph-unreachable task and backfills reachable work', async () => {
    const { service, cargos, kernelApi } = build();
    cargos.get('c1')!.sourcePointName = 'ISOLATED';

    await service.run();

    const dispatchedTaskIds = kernelApi.createTransportOrder.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
    );
    expect(dispatchedTaskIds).toEqual(['t2', 't3']);
  });

  it('keeps a route-conflicted FIFO task pending when the first task invalidates', async () => {
    const { service, cargos, kernelApi, pickupDependency, routing } = build();
    cargos.get('c1')!.sourcePointName = 'A';
    cargos.get('c2')!.sourcePointName = 'A';
    cargos.get('c3')!.sourcePointName = 'B';
    routing.getReverseRoadGraph.mockResolvedValue(
      buildRoadGraph([twoWay('A', 'S2', 1), twoWay('B', 'V2-POS', 1)]),
    );
    const checks = new Map<string, number>();
    pickupDependency.isBlocked.mockImplementation((task: { id: string }) => {
      const count = (checks.get(task.id) ?? 0) + 1;
      checks.set(task.id, count);
      return Promise.resolve(task.id === 't1' && count === 2);
    });

    await service.run();

    const dispatchedTaskIds = kernelApi.createTransportOrder.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
    );
    expect(dispatchedTaskIds).toEqual(['t2', 't3']);
  });

  it('with an active urgency policy, a lane-blocking task jumps the FIFO queue', async () => {
    const { service, dispatchPolicy, kernelApi, pickupDependency } = build();
    dispatchPolicy.getActiveWeights.mockResolvedValue({
      urgency: 5,
      battery: 0,
    });
    pickupDependency.blockingCounts.mockResolvedValue(new Map([['t3', 3]]));

    await service.run();

    const dispatchedTaskIds = kernelApi.createTransportOrder.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
    );
    expect(dispatchedTaskIds).toEqual(['t3', 't1']);
    expect(pickupDependency.blockingCounts).toHaveBeenCalledTimes(1);
  });

  it('keeps plain FIFO when the active policy has urgency weight 0', async () => {
    const { service, dispatchPolicy, kernelApi, pickupDependency } = build();
    dispatchPolicy.getActiveWeights.mockResolvedValue({
      urgency: 0,
      battery: 0,
    });

    await service.run();

    const dispatchedTaskIds = kernelApi.createTransportOrder.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
    );
    expect(dispatchedTaskIds).toEqual(['t1', 't2']);
    expect(pickupDependency.blockingCounts).not.toHaveBeenCalled();
  });

  it('excludes an ambiguous duplicate vehicle name from dispatch', async () => {
    const { service, agvRepo, kernelApi } = build();
    agvRepo.find.mockResolvedValue([
      {
        id: 'duplicate-1',
        name: 'V1',
        isDispatchEnabled: true,
        isIgnored: false,
        operationalBatteryThreshold: 20,
      },
      {
        id: 'duplicate-2',
        name: 'V1',
        isDispatchEnabled: true,
        isIgnored: false,
        operationalBatteryThreshold: 20,
      },
    ]);

    await service.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
  });

  describe('DISPATCH_MATCHER', () => {
    const originalMatcher = process.env.DISPATCH_MATCHER;

    afterEach(() => {
      if (originalMatcher === undefined) delete process.env.DISPATCH_MATCHER;
      else process.env.DISPATCH_MATCHER = originalMatcher;
    });

    const dispatchedVehicleFor = (
      kernelApi: { createTransportOrder: jest.Mock },
      call: number,
    ): string =>
      kernelApi.createTransportOrder.mock.calls[call - 1][2] as string;

    it('dispatches the greedy pairing and records the hungarian counterfactual', async () => {
      process.env.DISPATCH_MATCHER = 'greedy';
      const { service, kernelApi, transportTask } = build();

      await service.run();

      expect(dispatchedVehicleFor(kernelApi, 1)).toBe('V1');
      expect(dispatchedVehicleFor(kernelApi, 2)).toBe('V2');
      expect(transportTask.changeStatus).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 't1' }),
        TaskStatus.PICKING_UP,
        expect.objectContaining({
          context: expect.objectContaining({
            matcher: 'greedy',
            batchSize: 2,
            distanceToSource: 4,
            altVehicleName: 'V2',
            altDistanceToSource: 6,
          }),
        }),
      );
    });

    it('dispatches the hungarian pairing and records the greedy counterfactual by default', async () => {
      delete process.env.DISPATCH_MATCHER;
      const { service, kernelApi, transportTask } = build();

      await service.run();

      expect(dispatchedVehicleFor(kernelApi, 1)).toBe('V2');
      expect(transportTask.changeStatus).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 't1' }),
        TaskStatus.PICKING_UP,
        expect.objectContaining({
          context: expect.objectContaining({
            matcher: 'hungarian',
            distanceToSource: 6,
            altVehicleName: 'V1',
            altDistanceToSource: 4,
          }),
        }),
      );
    });

    it('falls back to hungarian on an unrecognised value', async () => {
      process.env.DISPATCH_MATCHER = 'hungarain';
      const { service, kernelApi } = build();

      await service.run();

      expect(dispatchedVehicleFor(kernelApi, 1)).toBe('V2');
    });
  });
});

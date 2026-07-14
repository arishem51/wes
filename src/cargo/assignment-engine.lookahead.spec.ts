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

describe('AssignmentEngineService lookahead', () => {
  const originalLookahead = process.env.DISPATCH_LOOKAHEAD;

  afterEach(() => {
    if (originalLookahead === undefined) delete process.env.DISPATCH_LOOKAHEAD;
    else process.env.DISPATCH_LOOKAHEAD = originalLookahead;
  });

  function build(
    options: {
      readonly tasks?: ReadonlyArray<{
        id: string;
        cargoId: string;
        ageMs: number;
      }>;
    } = {},
  ) {
    const now = Date.now();
    const readyTasks = (
      options.tasks ?? [
        { id: 'tA', cargoId: 'cA', ageMs: 0 },
        { id: 'tB', cargoId: 'cB', ageMs: 0 },
      ]
    ).map((task) => ({
      id: task.id,
      cargoId: task.cargoId,
      status: TaskStatus.READY_TO_ASSIGN,
      metadata: {},
      createdAt: new Date(now - task.ageMs),
    }));

    const deliveringTask = {
      id: 'tD',
      cargoId: 'cD',
      status: TaskStatus.DELIVERING,
      metadata: { assignedVehicleName: 'V2' },
      createdAt: new Date(now),
    };
    const deliveringCargo = { id: 'cD', destinationLocationName: 'LOC-D' };

    const cargos = new Map([
      [
        'cA',
        { id: 'cA', sourcePickupLocationName: 'LOC-A', sourcePointName: 'SA' },
      ],
      [
        'cB',
        { id: 'cB', sourcePickupLocationName: 'LOC-B', sourcePointName: 'SB' },
      ],
    ]);

    const taskRepo = {
      find: jest
        .fn()
        .mockImplementation((opts: { where?: { status?: unknown } }) =>
          opts?.where?.status === TaskStatus.READY_TO_ASSIGN
            ? Promise.resolve(readyTasks)
            : Promise.resolve([deliveringTask]),
        ),
    };
    const cargoRepo = {
      findOne: jest
        .fn()
        .mockImplementation((opts: { where: { id: string } }) =>
          Promise.resolve(cargos.get(opts.where.id) ?? null),
        ),
      find: jest.fn().mockResolvedValue([deliveringCargo]),
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
    };
    const states = new Map<string, unknown>([
      [
        'V1',
        {
          procState: 'IDLE',
          integrationLevel: 'TO_BE_UTILIZED',
          transportOrder: null,
          currentPosition: 'PFREE',
          energyLevel: 80,
        },
      ],
      [
        'V2',
        {
          procState: 'PROCESSING_ORDER',
          integrationLevel: 'TO_BE_UTILIZED',
          transportOrder: 'PICKUP-in-flight',
          currentPosition: 'PMID',
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
      isBlocked: jest.fn().mockResolvedValue(false),
      blockingCounts: jest.fn().mockResolvedValue(new Map<string, number>()),
    };
    const dispatchPolicy = {
      getActiveWeights: jest.fn().mockResolvedValue(null),
    };
    const routing = {
      getReverseRoadGraph: jest
        .fn()
        .mockResolvedValue(
          buildRoadGraph([
            twoWay('D', 'SA', 1),
            twoWay('PMID', 'D', 2),
            twoWay('PFREE', 'SA', 10),
            twoWay('PFREE', 'SB', 12),
          ]),
        ),
      pointsOfLocations: jest.fn().mockResolvedValue(new Map([['LOC-D', 'D']])),
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
    return { service, kernelApi, transportTask, routing };
  }

  const dispatched = (kernelApi: { createTransportOrder: jest.Mock }) =>
    kernelApi.createTransportOrder.mock.calls.map((call: unknown[]) => ({
      taskId: (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
      vehicle: call[2] as string,
    }));

  it('sends the free vehicle to the FAR task and holds the near one for the vehicle about to finish', async () => {
    const { service, kernelApi } = build();

    await service.run();

    expect(dispatched(kernelApi)).toEqual([{ taskId: 'tB', vehicle: 'V1' }]);
  });

  it('never dispatches to a vehicle that is only about to become free', async () => {
    const { service, kernelApi } = build();

    await service.run();

    expect(
      kernelApi.createTransportOrder.mock.calls.map(
        (call: unknown[]) => call[2],
      ),
    ).not.toContain('V2');
  });

  it('records the reserved task and the lookahead fleet size', async () => {
    const { service, transportTask } = build();

    await service.run();

    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tB' }),
      TaskStatus.PICKING_UP,
      expect.objectContaining({
        context: expect.objectContaining({
          lookahead: true,
          lookaheadVehicles: 1,
          reservedTasks: 1,
          batchSize: 2,
        }),
      }),
    );
  });

  it('with lookahead off, the free vehicle grabs the near task and the far one waits', async () => {
    process.env.DISPATCH_LOOKAHEAD = 'off';
    const { service, kernelApi, routing } = build();

    await service.run();

    expect(dispatched(kernelApi)).toEqual([{ taskId: 'tA', vehicle: 'V1' }]);
    expect(routing.pointsOfLocations).not.toHaveBeenCalled();
  });

  it('admits no soon-free vehicle when the free fleet already covers every task', async () => {
    const { service, kernelApi } = build({
      tasks: [{ id: 'tA', cargoId: 'cA', ageMs: 0 }],
    });

    await service.run();

    expect(dispatched(kernelApi)).toEqual([{ taskId: 'tA', vehicle: 'V1' }]);
  });

  it('stops holding a task once it has been passed over for longer than T_max', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const start = Date.now();
    nowSpy.mockReturnValue(start);
    const { service, kernelApi } = build();

    await service.run();
    expect(dispatched(kernelApi)).toEqual([{ taskId: 'tB', vehicle: 'V1' }]);

    nowSpy.mockReturnValue(start + 120_000);
    await service.run();

    expect(dispatched(kernelApi)).toEqual([
      { taskId: 'tB', vehicle: 'V1' },
      { taskId: 'tA', vehicle: 'V1' },
    ]);
    nowSpy.mockRestore();
  });
});

describe('AssignmentEngineService lookahead column cap', () => {
  function build() {
    const now = Date.now();
    const readyTasks = [
      { id: 'tA', cargoId: 'cA' },
      { id: 'tB', cargoId: 'cB' },
    ].map((task) => ({
      ...task,
      status: TaskStatus.READY_TO_ASSIGN,
      metadata: {},
      createdAt: new Date(now),
    }));
    const deliveringTask = {
      id: 'tD',
      cargoId: 'cD',
      status: TaskStatus.DELIVERING,
      metadata: { assignedVehicleName: 'V3' },
      createdAt: new Date(now),
    };
    const cargos = new Map([
      [
        'cA',
        { id: 'cA', sourcePickupLocationName: 'LOC-A', sourcePointName: 'SA' },
      ],
      [
        'cB',
        { id: 'cB', sourcePickupLocationName: 'LOC-B', sourcePointName: 'SB' },
      ],
    ]);

    const taskRepo = {
      find: jest
        .fn()
        .mockImplementation((opts: { where?: { status?: unknown } }) =>
          opts?.where?.status === TaskStatus.READY_TO_ASSIGN
            ? Promise.resolve(readyTasks)
            : Promise.resolve([deliveringTask]),
        ),
    };
    const cargoRepo = {
      findOne: jest
        .fn()
        .mockImplementation((opts: { where: { id: string } }) =>
          Promise.resolve(cargos.get(opts.where.id) ?? null),
        ),
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'cD', destinationLocationName: 'LOC-D' }]),
    };
    const free = (name: string, position: string) => [
      name,
      {
        procState: 'IDLE',
        integrationLevel: 'TO_BE_UTILIZED',
        transportOrder: null,
        currentPosition: position,
        energyLevel: 80,
      },
    ];
    const states = new Map<string, unknown>([
      free('V1', 'P1') as [string, unknown],
      free('V2', 'P2') as [string, unknown],
      [
        'V3',
        {
          procState: 'PROCESSING_ORDER',
          integrationLevel: 'TO_BE_UTILIZED',
          transportOrder: 'DROPOFF-in-flight',
          currentPosition: 'D',
          energyLevel: 80,
        },
      ],
    ]);
    const agvRepo = {
      find: jest.fn().mockResolvedValue(
        ['V1', 'V2', 'V3'].map((name) => ({
          name,
          isDispatchEnabled: true,
          isIgnored: false,
          operationalBatteryThreshold: 20,
        })),
      ),
    };
    const kernelApi = {
      withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
      createTransportOrder: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AssignmentEngineService(
      taskRepo as never,
      cargoRepo as never,
      agvRepo as never,
      kernelApi as never,
      {
        get: jest.fn().mockImplementation((name: string) => states.get(name)),
      } as never,
      { changeStatus: jest.fn().mockResolvedValue(undefined) } as never,
      {
        isBlocked: jest.fn().mockResolvedValue(false),
        blockingCounts: jest.fn().mockResolvedValue(new Map<string, number>()),
      } as never,
      {
        getReverseRoadGraph: jest
          .fn()
          .mockResolvedValue(
            buildRoadGraph([
              twoWay('P1', 'SA', 1),
              twoWay('P1', 'SB', 2),
              twoWay('P2', 'SB', 3),
              twoWay('D', 'SA', 1),
            ]),
          ),
        pointsOfLocations: jest
          .fn()
          .mockResolvedValue(new Map([['LOC-D', 'D']])),
      } as never,
      { getActiveWeights: jest.fn().mockResolvedValue(null) } as never,
    );
    return { service, kernelApi };
  }

  it('keeps a soon-free vehicle out of a task the free fleet can take right now', async () => {
    const { service, kernelApi } = build();

    await service.run();

    expect(
      kernelApi.createTransportOrder.mock.calls.map((call: unknown[]) => ({
        taskId: (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
        vehicle: call[2] as string,
      })),
    ).toEqual([
      { taskId: 'tA', vehicle: 'V1' },
      { taskId: 'tB', vehicle: 'V2' },
    ]);
  });
});

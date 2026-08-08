import { AssignmentEngineService } from './assignment-engine.service';
import { DispatchDistanceService } from './dispatch-distance.service';
import { VehicleCandidateService } from './vehicle-candidate.service';
import { PickupOrderService } from './pickup-order.service';
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

const stub = <T>(value: unknown): T => value as T;

interface BuildOptions {
  readonly heldVehicles?: readonly string[];
  readonly readyTaskIds?: readonly string[];
  readonly pinnedTaskIds?: ReadonlySet<string>;
}

describe('AssignmentEngineService pickup swapping', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function build({
    heldVehicles = ['V-HOLD'],
    readyTaskIds = ['t2'],
    pinnedTaskIds = new Set<string>(),
  }: BuildOptions = {}) {
    const allTasks = [
      {
        id: 't1',
        cargoId: 'c1',
        status: TaskStatus.PICKING_UP,
        metadata: { assignedVehicleName: 'V-HOLD', to1Name: 'PICKUP-OLD-1' },
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        startedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 't2',
        cargoId: 'c2',
        status: TaskStatus.READY_TO_ASSIGN,
        metadata: {},
        assignedAt: null,
        startedAt: null,
        createdAt: new Date('2026-01-01T00:00:01Z'),
      },
      {
        id: 't3',
        cargoId: 'c3',
        status: TaskStatus.PICKING_UP,
        metadata: { assignedVehicleName: 'V-FREE', to1Name: 'PICKUP-OLD-3' },
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        startedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:02Z'),
      },
    ];
    const taskById = new Map(allTasks.map((task) => [task.id, task]));
    const held = heldVehicles.map((vehicle) =>
      vehicle === 'V-HOLD' ? taskById.get('t1')! : taskById.get('t3')!,
    );
    const ready = readyTaskIds.map((id) => taskById.get(id)!);

    const cargos = new Map([
      [
        'c1',
        { id: 'c1', sourcePickupLocationName: 'LOC-1', sourcePointName: 'S1' },
      ],
      [
        'c2',
        { id: 'c2', sourcePickupLocationName: 'LOC-2', sourcePointName: 'S2' },
      ],
      [
        'c3',
        { id: 'c3', sourcePickupLocationName: 'LOC-3', sourcePointName: 'S2' },
      ],
    ]);

    const taskRepo = {
      find: jest
        .fn()
        .mockImplementation((opts: { where?: { status?: unknown } }) =>
          Promise.resolve(
            opts?.where?.status === TaskStatus.READY_TO_ASSIGN ? ready : held,
          ),
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
          name: 'V-FREE',
          isDispatchEnabled: true,
          isIgnored: false,
          criticalBatteryThreshold: 20,
        },
        {
          name: 'V-HOLD',
          isDispatchEnabled: true,
          isIgnored: false,
          criticalBatteryThreshold: 20,
        },
      ]),
    };
    const kernelApi = {
      withdrawTransportOrder: jest.fn().mockResolvedValue(undefined),
      createTransportOrder: jest.fn().mockResolvedValue(undefined),
      loadOperation: 'PICK_UP',
      unloadOperation: 'DROP_OFF',
    };
    const heldNames = new Set(heldVehicles);
    const vehicleStore = {
      get: jest.fn().mockImplementation((name: string) => ({
        procState: heldNames.has(name) ? 'PROCESSING_ORDER' : 'IDLE',
        integrationLevel: 'TO_BE_UTILIZED',
        transportOrder: heldNames.has(name) ? 'PICKUP-OLD' : null,
        currentPosition: name === 'V-HOLD' ? 'PH' : 'PF',
        energyLevel: 80,
      })),
    };
    const transportTask = {
      changeStatus: jest
        .fn()
        .mockImplementation((task: { status: TaskStatus }, to: TaskStatus) => {
          task.status = to;
          return Promise.resolve(task);
        }),
    };
    const pickupDependency = { isBlocked: jest.fn().mockResolvedValue(false) };
    const laneSafety = {
      committedInsideLane: jest.fn().mockResolvedValue(new Set(pinnedTaskIds)),
    };
    const dispatchPolicy = {
      getActiveWeights: jest.fn().mockResolvedValue(null),
    };
    const routing = {
      getReverseRoadGraph: jest
        .fn()
        .mockResolvedValue(
          buildRoadGraph([
            twoWay('PH', 'S1', 18_000),
            twoWay('PF', 'S1', 10_000),
            twoWay('PH', 'S2', 1_000),
            twoWay('PF', 'S2', 1_000),
          ]),
        ),
    };
    const zoneRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const approachPoint = { feederPointsOf: jest.fn().mockResolvedValue([]) };

    const service = new AssignmentEngineService(
      stub(taskRepo),
      stub(cargoRepo),
      stub(pickupDependency),
      stub(laneSafety),
      stub(dispatchPolicy),
      new DispatchDistanceService(
        stub(zoneRepo),
        stub(routing),
        stub(approachPoint),
      ),
      new VehicleCandidateService(stub(agvRepo), stub(vehicleStore)),
      new PickupOrderService(stub(kernelApi), stub(transportTask)),
    );
    return { service, kernelApi, transportTask, taskById, laneSafety };
  }

  const dispatchedFor = (kernelApi: { createTransportOrder: jest.Mock }) =>
    kernelApi.createTransportOrder.mock.calls.map((call: unknown[]) => [
      (call[3] as Record<string, string>)[ORDER_PROP.TASK_ID],
      call[2] as string,
    ]);

  const statusCallsFor = (transportTask: { changeStatus: jest.Mock }) =>
    transportTask.changeStatus.mock.calls.map(
      (call: [{ id: string }, TaskStatus]) => [call[0].id, call[1]],
    );

  it('leaves in-flight pickups untouched while the feature is off', async () => {
    const { service, kernelApi, transportTask } = build();

    await service.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(dispatchedFor(kernelApi)).toEqual([['t2', 'V-FREE']]);
    expect(statusCallsFor(transportTask)).toEqual([
      ['t2', TaskStatus.PICKING_UP],
    ]);
  });

  it('hands the pickup to the closer vehicle and backfills the robbed one', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '1000';
    const { service, kernelApi, transportTask } = build();

    await service.run();

    expect(kernelApi.withdrawTransportOrder).toHaveBeenCalledWith(
      'PICKUP-OLD-1',
      false,
    );
    expect(statusCallsFor(transportTask)).toEqual([
      ['t1', TaskStatus.READY_TO_ASSIGN],
      ['t1', TaskStatus.PICKING_UP],
      ['t2', TaskStatus.PICKING_UP],
    ]);
    expect(dispatchedFor(kernelApi)).toEqual([
      ['t1', 'V-FREE'],
      ['t2', 'V-HOLD'],
    ]);
  });

  it('records the handover on the revoking transition', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '1000';
    const { service, transportTask } = build();

    await service.run();

    expect(transportTask.changeStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 't1' }),
      TaskStatus.READY_TO_ASSIGN,
      expect.objectContaining({
        trigger: 'ASSIGNMENT_ENGINE',
        vehicleName: 'V-HOLD',
        context: expect.objectContaining({
          swap: true,
          swapCount: 1,
          fromVehicleName: 'V-HOLD',
          toVehicleName: 'V-FREE',
          withdrawnOrder: 'PICKUP-OLD-1',
        }),
      }),
    );
  });

  it('blanks the counterfactual on a swapped row so deadhead stays comparable', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '1000';
    const { service, transportTask } = build();

    await service.run();

    expect(transportTask.changeStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 't1' }),
      TaskStatus.PICKING_UP,
      expect.objectContaining({
        context: expect.objectContaining({
          altVehicleName: null,
          altDistanceToSource: null,
          swapCount: 1,
        }),
      }),
    );
  });

  it('keeps the incumbent when the gain does not clear the threshold', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '3000';
    const { service, kernelApi, transportTask } = build();

    await service.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(dispatchedFor(kernelApi)).toEqual([['t2', 'V-FREE']]);
    expect(statusCallsFor(transportTask)).toEqual([
      ['t2', TaskStatus.PICKING_UP],
    ]);
  });

  it('refuses to move a pickup whose vehicle is already inside the lane', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '1000';
    const { service, kernelApi } = build({ pinnedTaskIds: new Set(['t1']) });

    await service.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(dispatchedFor(kernelApi)).toEqual([['t2', 'V-FREE']]);
  });

  it('refuses to move a pickup that has spent its recourse budget', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '1000';
    const { service, kernelApi, taskById } = build();
    taskById.get('t1')!.metadata = {
      ...taskById.get('t1')!.metadata,
      swapCount: 2,
    } as never;

    await service.run();

    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
    expect(dispatchedFor(kernelApi)).toEqual([['t2', 'V-FREE']]);
  });

  it('leaves the task queued when the replacement order cannot be created', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '1000';
    const { service, kernelApi, transportTask, taskById } = build();
    kernelApi.createTransportOrder.mockImplementation(
      (_name: string, _destinations: unknown, vehicleName: string) =>
        vehicleName === 'V-FREE'
          ? Promise.reject(new Error('rejected'))
          : Promise.resolve(),
    );

    await service.run();

    expect(statusCallsFor(transportTask)).toEqual([
      ['t1', TaskStatus.READY_TO_ASSIGN],
      ['t2', TaskStatus.PICKING_UP],
    ]);
    expect(taskById.get('t1')!.status).toBe(TaskStatus.READY_TO_ASSIGN);
    expect(taskById.get('t1')!.metadata.assignedVehicleName).toBeUndefined();
  });

  it('terminates when every in-flight pickup is already on its best vehicle', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '3000';
    const { service, kernelApi } = build({
      heldVehicles: ['V-HOLD', 'V-FREE'],
      readyTaskIds: [],
    });

    await service.run();

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
    expect(kernelApi.withdrawTransportOrder).not.toHaveBeenCalled();
  });

  it('exchanges pickups between two driving vehicles with no idle vehicle at all', async () => {
    process.env.DISPATCH_SWAP = 'on';
    process.env.DISPATCH_SWAP_BASE_MM = '0';
    const { service, kernelApi } = build({
      heldVehicles: ['V-HOLD', 'V-FREE'],
      readyTaskIds: [],
    });

    await service.run();

    expect(
      kernelApi.withdrawTransportOrder.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      ),
    ).toEqual(['PICKUP-OLD-1', 'PICKUP-OLD-3']);
    expect(dispatchedFor(kernelApi)).toEqual([
      ['t1', 'V-FREE'],
      ['t3', 'V-HOLD'],
    ]);
  });
});

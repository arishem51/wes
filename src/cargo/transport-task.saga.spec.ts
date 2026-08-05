import { TransportTaskSaga } from './transport-task.saga';
import { FmsTransportOrderFinishedEvent } from './domain/events';
import { CargoStatus } from './entities/cargo.entity';
import { TaskStatus } from './entities/transport-task.entity';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Build a saga with only taskRepo.findOne wired — the single-flight guard drops
 *  the duplicate before any other dependency is touched. */
function makeSaga(findOne: jest.Mock): TransportTaskSaga {
  const taskRepo = { findOne };
  return new TransportTaskSaga(
    taskRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('TransportTaskSaga single-flight', () => {
  const event = () =>
    new FmsTransportOrderFinishedEvent('PICKUP-1', 'task-1', 'PICKUP');

  it('drops a duplicate finished-event while the task is already in flight', async () => {
    const d = deferred<null>();
    const findOne = jest.fn().mockReturnValue(d.promise);
    const saga = makeSaga(findOne);

    const p1 = saga.onTransportOrderFinished(event()); // enters, awaits findOne
    const p2 = saga.onTransportOrderFinished(event()); // sees in-flight → returns

    await p2;
    expect(findOne).toHaveBeenCalledTimes(1); // duplicate never reached findTask

    d.resolve(null); // task "not found" → first handler returns
    await p1;
  });

  it('handles the task again once the previous handling has finished', async () => {
    const d1 = deferred<null>();
    const findOne = jest.fn().mockReturnValue(d1.promise);
    const saga = makeSaga(findOne);

    const p1 = saga.onTransportOrderFinished(event());
    d1.resolve(null);
    await p1; // lock released

    const d2 = deferred<null>();
    findOne.mockReturnValue(d2.promise);
    const p2 = saga.onTransportOrderFinished(event());
    d2.resolve(null);
    await p2;

    expect(findOne).toHaveBeenCalledTimes(2); // second, non-overlapping event ran
  });

  it('releases the lock even if handling throws', async () => {
    const findOne = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(null);
    const saga = makeSaga(findOne);

    await expect(saga.onTransportOrderFinished(event())).rejects.toThrow(
      'boom',
    );
    // Lock must have been released in `finally`, so the next event is handled.
    await saga.onTransportOrderFinished(event());
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});

const SLOT = 'location_3003';
const RETREAT_PATH = ['3002', '3001'];
const RETREAT_POINT = RETREAT_PATH[RETREAT_PATH.length - 1];

function makeDropOffSaga(
  options: {
    task?: Record<string, unknown>;
    cargo?: Record<string, unknown>;
    retreatPath?: string[] | null;
    freeSlot?: string | null;
  } = {},
) {
  const task = {
    id: 'task-1',
    status: TaskStatus.DELIVERING,
    cargoId: 'cargo-1',
    metadata: { assignedVehicleName: 'V1', to2Name: 'APPROACH-V1-0091-x' },
    ...options.task,
  };
  const cargo = {
    id: 'cargo-1',
    destinationZoneId: 'zone-1',
    destinationLocationName: SLOT,
    ...options.cargo,
  };

  const taskRepo = {
    findOne: jest.fn().mockResolvedValue(task),
    save: jest.fn().mockResolvedValue(task),
  };
  const cargoRepo = {
    findOne: jest.fn().mockResolvedValue(cargo),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const zoneRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'zone-1', name: 'zone_1' }),
  };
  const retreatPoint = {
    pathFor: jest
      .fn()
      .mockResolvedValue(
        options.retreatPath === undefined ? RETREAT_PATH : options.retreatPath,
      ),
  };

  const lockedManagerRepo = {
    findOne: jest.fn().mockResolvedValue({ ...cargo, ...options.cargo }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const retreatCallsWhileLocked = { count: -1 };
  const dataSource = {
    transaction: jest.fn(
      async (run: (manager: unknown) => Promise<unknown>) => {
        const result = await run({
          query: jest.fn().mockResolvedValue(undefined),
          getRepository: jest.fn().mockReturnValue(lockedManagerRepo),
        });
        retreatCallsWhileLocked.count = retreatPoint.pathFor.mock.calls.length;
        return result;
      },
    ),
  };

  const kernelApi = {
    unloadOperation: 'liftDown',
    createTransportOrder: jest.fn().mockResolvedValue({}),
  };
  const transportTask = {
    changeStatus: jest.fn().mockResolvedValue(undefined),
  };
  const deliverySlotEngine = {
    findSlot: jest
      .fn()
      .mockResolvedValue(
        options.freeSlot === undefined ? SLOT : options.freeSlot,
      ),
  };

  const saga = new TransportTaskSaga(
    taskRepo as never,
    cargoRepo as never,
    zoneRepo as never,
    dataSource as never,
    kernelApi as never,
    transportTask as never,
    deliverySlotEngine as never,
    {} as never,
    retreatPoint as never,
  );

  return {
    saga,
    task,
    taskRepo,
    cargoRepo,
    dataSource,
    kernelApi,
    transportTask,
    deliverySlotEngine,
    lockedManagerRepo,
    retreatPoint,
    retreatCallsWhileLocked,
  };
}

const approachFinished = () =>
  new FmsTransportOrderFinishedEvent(
    'APPROACH-V1-0091-x',
    'task-1',
    'APPROACH',
  );

describe('TransportTaskSaga drop-off retreat', () => {
  it('creates TO3 with the drop-off then one MOVE per retreat cell, in that order', async () => {
    const { saga, kernelApi } = makeDropOffSaga();

    await saga.onTransportOrderFinished(approachFinished());

    const [, destinations] = kernelApi.createTransportOrder.mock.calls[0];
    expect(destinations).toEqual([
      { locationName: SLOT, operation: 'liftDown' },
      { locationName: '3002', operation: 'MOVE' },
      { locationName: '3001', operation: 'MOVE' },
    ]);
  });

  it('never collapses the retreat into a single destination at the far cell', async () => {
    const { saga, kernelApi } = makeDropOffSaga({
      retreatPath: ['3002', '3001', '0091'],
    });

    await saga.onTransportOrderFinished(approachFinished());

    const [, destinations] = kernelApi.createTransportOrder.mock.calls[0];
    expect(destinations).toHaveLength(4);
    expect(
      (destinations as { locationName: string }[]).map((d) => d.locationName),
    ).toEqual([SLOT, '3002', '3001', '0091']);
  });

  it('keeps TO3 on the DROPOFF leg and pins the assigned vehicle', async () => {
    const { saga, kernelApi } = makeDropOffSaga();

    await saga.onTransportOrderFinished(approachFinished());

    const [orderName, , vehicle, properties] =
      kernelApi.createTransportOrder.mock.calls[0];
    expect(orderName).toMatch(/^DROPOFF-V1-/);
    expect(vehicle).toBe('V1');
    expect(properties).toEqual({
      'wes:taskId': 'task-1',
      'wes:leg': 'DROPOFF',
    });
  });

  it('records the last retreat cell on the task metadata', async () => {
    const { saga, taskRepo } = makeDropOffSaga();

    await saga.onTransportOrderFinished(approachFinished());

    const saved = taskRepo.save.mock.calls[0][0] as {
      metadata: Record<string, string>;
    };
    expect(saved.metadata.retreatPointName).toBe(RETREAT_POINT);
    expect(saved.metadata.to3Name).toMatch(/^DROPOFF-V1-/);
  });

  it('still delivers with a single destination when no retreat path resolves', async () => {
    const { saga, kernelApi, taskRepo } = makeDropOffSaga({
      retreatPath: null,
    });

    await saga.onTransportOrderFinished(approachFinished());

    const [, destinations] = kernelApi.createTransportOrder.mock.calls[0];
    expect(destinations).toEqual([
      { locationName: SLOT, operation: 'liftDown' },
    ]);
    const saved = taskRepo.save.mock.calls[0][0] as {
      metadata: Record<string, string | undefined>;
    };
    expect(saved.metadata.retreatPointName).toBeUndefined();
    expect(saved.metadata.to3Name).toMatch(/^DROPOFF-V1-/);
  });

  it('never resolves the retreat path inside the slot-commit transaction', async () => {
    const { saga, dataSource, retreatCallsWhileLocked, retreatPoint } =
      makeDropOffSaga({ cargo: { destinationLocationName: null } });

    await saga.onTransportOrderFinished(approachFinished());

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(retreatCallsWhileLocked.count).toBe(0);
    expect(retreatPoint.pathFor).toHaveBeenCalledTimes(1);
  });

  it('commits a slot at the barrier and retreats from the committed slot', async () => {
    const { saga, lockedManagerRepo, retreatPoint, kernelApi } =
      makeDropOffSaga({ cargo: { destinationLocationName: null } });

    await saga.onTransportOrderFinished(approachFinished());

    expect(lockedManagerRepo.update).toHaveBeenCalledWith('cargo-1', {
      destinationLocationName: SLOT,
    });
    expect(retreatPoint.pathFor).toHaveBeenCalledWith(SLOT);
    const [, destinations] = kernelApi.createTransportOrder.mock.calls[0];
    expect(destinations).toHaveLength(1 + RETREAT_PATH.length);
  });

  it('fails the task when the barrier finds no free slot', async () => {
    const { saga, transportTask, kernelApi, retreatPoint } = makeDropOffSaga({
      cargo: { destinationLocationName: null },
      freeSlot: null,
    });

    await saga.onTransportOrderFinished(approachFinished());

    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      expect.anything(),
      TaskStatus.FAILED,
      expect.objectContaining({ trigger: 'SAGA' }),
    );
    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
    expect(retreatPoint.pathFor).not.toHaveBeenCalled();
  });

  it('ignores a duplicate approach-finished once TO3 exists', async () => {
    const { saga, kernelApi, retreatPoint } = makeDropOffSaga({
      task: {
        metadata: {
          assignedVehicleName: 'V1',
          to2Name: 'APPROACH-V1-0091-x',
          to3Name: 'DROPOFF-V1-location_3003-y',
        },
      },
    });

    await saga.onTransportOrderFinished(approachFinished());

    expect(kernelApi.createTransportOrder).not.toHaveBeenCalled();
    expect(retreatPoint.pathFor).not.toHaveBeenCalled();
  });
});

describe('TransportTaskSaga drop-off completion', () => {
  const dropOffFinished = () =>
    new FmsTransportOrderFinishedEvent(
      'DROPOFF-V1-location_3003-y',
      'task-1',
      'DROPOFF',
    );

  it('completes the task and marks the cargo delivered after the retreat', async () => {
    const { saga, transportTask, cargoRepo, task } = makeDropOffSaga();

    await saga.onTransportOrderFinished(dropOffFinished());

    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      task,
      TaskStatus.DELIVERY_COMPLETED,
      { trigger: 'SAGA' },
    );
    expect(cargoRepo.update).toHaveBeenCalledWith('cargo-1', {
      status: CargoStatus.DELIVERED,
    });
  });
});

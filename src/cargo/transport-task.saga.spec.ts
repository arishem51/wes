import { TransportTaskSaga } from './transport-task.saga';
import { FmsTransportOrderFinishedEvent } from './domain/events';

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

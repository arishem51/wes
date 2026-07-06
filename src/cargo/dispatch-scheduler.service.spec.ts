import { DispatchSchedulerService } from './dispatch-scheduler.service';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const engine = (run: jest.Mock) => ({ run }) as never;
const flushOf = (svc: DispatchSchedulerService) =>
  (svc as unknown as { flush(): Promise<void> }).flush();

describe('DispatchSchedulerService single-flight', () => {
  it('never runs two flush cycles concurrently', async () => {
    const gate = deferred<void>();
    const leg = jest.fn().mockReturnValue(gate.promise); // hold flush #1 open
    const release = jest.fn().mockResolvedValue(undefined);
    const assign = jest.fn().mockResolvedValue(undefined);
    const park = jest.fn().mockResolvedValue(undefined);
    const svc = new DispatchSchedulerService(
      engine(leg),
      engine(release),
      engine(assign),
      engine(park),
    );

    const p1 = flushOf(svc); // enters, awaits leg-reconcile (pending)
    const p2 = flushOf(svc); // sees in-flight → returns immediately
    await p2;

    // Flush #2 did not start the pipeline; flush #1 is still stuck on leg-reconcile.
    expect(leg).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    gate.resolve();
    await p1;

    // The whole pipeline ran exactly once, in order.
    expect(leg).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(park).toHaveBeenCalledTimes(1);
  });

  it('re-schedules once when a trigger arrives mid-flush (no work dropped)', async () => {
    const gate = deferred<void>();
    const leg = jest.fn().mockReturnValue(gate.promise);
    const ok = () => jest.fn().mockResolvedValue(undefined);
    const svc = new DispatchSchedulerService(
      engine(leg),
      engine(ok()),
      engine(ok()),
      engine(ok()),
    );
    // Stub schedule so the rerun doesn't leave a real timer pending.
    const schedule = jest
      .spyOn(svc, 'schedule')
      .mockImplementation(() => undefined);

    const p1 = flushOf(svc); // in flight
    await flushOf(svc); // mid-flush trigger → marks rerunWanted
    gate.resolve();
    await p1;

    expect(schedule).toHaveBeenCalledTimes(1); // rerun requested exactly once
  });
});

import { SlotReclaimService } from './slot-reclaim.service';
import { CargoStatus } from './entities/cargo.entity';
import { TaskStatus } from './entities/transport-task.entity';
import { TransportTaskFailedEvent } from './domain/events';

const ZONE = { id: 'zone-1', name: 'trả hàng 3' };

interface FakeCargo {
  id: string;
  status: CargoStatus;
  destinationZoneId: string | null;
  destinationLocationName: string | null;
}

interface FakeTask {
  id: string;
  cargoId: string | null;
  status: TaskStatus;
  metadata: Record<string, unknown>;
}

function cargo(overrides: Partial<FakeCargo> = {}): FakeCargo {
  return {
    id: 'cargo-1',
    status: CargoStatus.ACTIVE,
    destinationZoneId: 'zone-1',
    destinationLocationName: 'location_3150',
    ...overrides,
  };
}

function task(overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id: 'task-1',
    cargoId: 'cargo-1',
    status: TaskStatus.FAILED,
    metadata: {
      assignedVehicleName: 'Vehicle-0001',
      dropoffOrderName: 'DROPOFF-Vehicle-0001-location_3150-abc',
    },
    ...overrides,
  };
}

function setup(cargos: FakeCargo[] = [cargo()], tasks: FakeTask[] = [task()]) {
  const cargoRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(cargos.find((c) => c.id === where.id) ?? null),
    ),
    find: jest.fn(() =>
      Promise.resolve(
        cargos.filter(
          (c) =>
            c.status === CargoStatus.ACTIVE &&
            c.destinationLocationName !== null,
        ),
      ),
    ),
  };
  const taskRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(tasks.find((t) => t.id === where.id) ?? null),
    ),
    find: jest.fn(() => Promise.resolve(tasks)),
  };
  const zoneRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === ZONE.id ? ZONE : null),
    ),
  };
  const slotReservation = {
    releaseCommit: jest.fn().mockResolvedValue(undefined),
  };
  const transportOrders = { cancel: jest.fn().mockResolvedValue(undefined) };

  const service = new SlotReclaimService(
    cargoRepo as never,
    taskRepo as never,
    zoneRepo as never,
    slotReservation as never,
    transportOrders as never,
  );
  return { service, cargoRepo, taskRepo, slotReservation, transportOrders };
}

describe('SlotReclaimService on a failed task', () => {
  it('takes the slot back so the lane opens again', async () => {
    const { service, slotReservation } = setup();

    await service.onTaskFailed(
      new TransportTaskFailedEvent('task-1', 'cargo-1'),
    );

    expect(slotReservation.releaseCommit).toHaveBeenCalledWith('cargo-1', ZONE);
  });

  it('cancels the drop-off order before letting anyone else have the slot', async () => {
    const { service, slotReservation, transportOrders } = setup();

    await service.onTaskFailed(
      new TransportTaskFailedEvent('task-1', 'cargo-1'),
    );

    expect(transportOrders.cancel).toHaveBeenCalledWith(
      'DROPOFF-Vehicle-0001-location_3150-abc',
    );
    expect(transportOrders.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      slotReservation.releaseCommit.mock.invocationCallOrder[0],
    );
  });

  it('still takes the slot back when the kernel refuses the cancellation', async () => {
    const { service, slotReservation, transportOrders } = setup();
    transportOrders.cancel.mockRejectedValueOnce(new Error('kernel down'));

    await service.onTaskFailed(
      new TransportTaskFailedEvent('task-1', 'cargo-1'),
    );

    expect(slotReservation.releaseCommit).toHaveBeenCalled();
  });

  it('has nothing to cancel when the task never got a drop-off order', async () => {
    const { service, slotReservation, transportOrders } = setup(
      [cargo()],
      [task({ metadata: { assignedVehicleName: 'Vehicle-0001' } })],
    );

    await service.onTaskFailed(
      new TransportTaskFailedEvent('task-1', 'cargo-1'),
    );

    expect(transportOrders.cancel).not.toHaveBeenCalled();
    expect(slotReservation.releaseCommit).toHaveBeenCalled();
  });

  it('leaves a task that never committed a slot alone', async () => {
    const { service, slotReservation, transportOrders } = setup([
      cargo({ destinationLocationName: null }),
    ]);

    await service.onTaskFailed(
      new TransportTaskFailedEvent('task-1', 'cargo-1'),
    );

    expect(slotReservation.releaseCommit).not.toHaveBeenCalled();
    expect(transportOrders.cancel).not.toHaveBeenCalled();
  });

  it('ignores a failure that carries no cargo at all', async () => {
    const { service, slotReservation, taskRepo } = setup();

    await service.onTaskFailed(new TransportTaskFailedEvent('task-1', null));

    expect(taskRepo.findOne).not.toHaveBeenCalled();
    expect(slotReservation.releaseCommit).not.toHaveBeenCalled();
  });

  it('leaves the slot alone when the zone is gone', async () => {
    const { service, slotReservation } = setup([
      cargo({ destinationZoneId: 'zone-missing' }),
    ]);

    await service.onTaskFailed(
      new TransportTaskFailedEvent('task-1', 'cargo-1'),
    );

    expect(slotReservation.releaseCommit).not.toHaveBeenCalled();
  });
});

describe('SlotReclaimService sweep', () => {
  it('picks up a commit left behind before the listener existed', async () => {
    const { service, slotReservation } = setup();

    await service.sweep();

    expect(slotReservation.releaseCommit).toHaveBeenCalledWith('cargo-1', ZONE);
  });

  it('takes back a cancelled task the failure event never fired for', async () => {
    const { service, slotReservation } = setup(
      [cargo()],
      [task({ status: TaskStatus.CANCELLED })],
    );

    await service.sweep();

    expect(slotReservation.releaseCommit).toHaveBeenCalled();
  });

  it('takes back a commit whose task no longer exists', async () => {
    const { service, slotReservation } = setup([cargo()], []);

    await service.sweep();

    expect(slotReservation.releaseCommit).toHaveBeenCalled();
  });

  it('never touches a vehicle still on its way to drop', async () => {
    const { service, slotReservation, transportOrders } = setup(
      [cargo()],
      [task({ status: TaskStatus.DELIVERING })],
    );

    await service.sweep();

    expect(slotReservation.releaseCommit).not.toHaveBeenCalled();
    expect(transportOrders.cancel).not.toHaveBeenCalled();
  });

  it('never touches a task that already delivered', async () => {
    const { service, slotReservation } = setup(
      [cargo()],
      [task({ status: TaskStatus.DELIVERY_COMPLETED })],
    );

    await service.sweep();

    expect(slotReservation.releaseCommit).not.toHaveBeenCalled();
  });

  it('keeps going after one cargo throws', async () => {
    const { service, slotReservation } = setup(
      [cargo(), cargo({ id: 'cargo-2' })],
      [task(), task({ id: 'task-2', cargoId: 'cargo-2' })],
    );
    slotReservation.releaseCommit.mockRejectedValueOnce(new Error('boom'));

    await service.sweep();

    expect(slotReservation.releaseCommit).toHaveBeenCalledTimes(2);
  });

  it('does not start a second sweep while one is still running', async () => {
    const { service, cargoRepo } = setup();
    let release: () => void = () => undefined;
    cargoRepo.find.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve([]);
      }) as never,
    );

    const first = service.sweep();
    await service.sweep();
    release();
    await first;

    expect(cargoRepo.find).toHaveBeenCalledTimes(1);
  });
});

import { ReleaseEngineService } from './release-engine.service';
import { TransportTaskEntity, TaskStatus } from './entities/transport-task.entity';

type Mocked = {
  taskRepo: { save: jest.Mock };
  transportTask: { changeStatus: jest.Mock };
  pickupDependency: { evaluate: jest.Mock };
};

function setup(): { svc: ReleaseEngineService } & Mocked {
  const taskRepo = { save: jest.fn() };
  const transportTask = { changeStatus: jest.fn() };
  const pickupDependency = { evaluate: jest.fn() };
  const svc = new ReleaseEngineService(
    taskRepo as never,
    transportTask as never,
    pickupDependency as never,
  );
  return { svc, taskRepo, transportTask, pickupDependency };
}

const task = (status: TaskStatus, metadata = {}): TransportTaskEntity =>
  ({ id: 'task-1', status, metadata }) as TransportTaskEntity;

describe('ReleaseEngineService', () => {
  it('leaves an in-flight PICKING_UP task alone when the row rule blocks it', async () => {
    const { svc, transportTask, taskRepo, pickupDependency } = setup();
    pickupDependency.evaluate.mockResolvedValue([
      {
        task: task(TaskStatus.PICKING_UP, {
          to1Name: 'PICKUP-1',
          assignedVehicleName: 'V1',
        }),
        blocked: true,
        reason: 'Blocked by cargo closer to the aisle in the same lane',
      },
    ]);

    await svc.run();

    expect(transportTask.changeStatus).not.toHaveBeenCalled();
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('blocks a CREATED task that fails the row rule', async () => {
    const { svc, transportTask, pickupDependency } = setup();
    const t = task(TaskStatus.CREATED);
    pickupDependency.evaluate.mockResolvedValue([
      { task: t, blocked: true, reason: 'behind another cargo' },
    ]);

    await svc.run();

    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      t,
      TaskStatus.BLOCKED,
      expect.objectContaining({ trigger: 'RELEASE_ENGINE' }),
    );
  });

  it('releases a BLOCKED task once the lane is free', async () => {
    const { svc, transportTask, pickupDependency } = setup();
    const t = task(TaskStatus.BLOCKED, { blockedReason: 'behind another cargo' });
    pickupDependency.evaluate.mockResolvedValue([
      { task: t, blocked: false, reason: null },
    ]);

    await svc.run();

    expect(transportTask.changeStatus).toHaveBeenCalledWith(
      t,
      TaskStatus.READY_TO_ASSIGN,
      expect.objectContaining({ trigger: 'RELEASE_ENGINE' }),
    );
  });

  it('does not re-release a task already in flight', async () => {
    const { svc, transportTask, pickupDependency } = setup();
    pickupDependency.evaluate.mockResolvedValue([
      { task: task(TaskStatus.PICKING_UP), blocked: false, reason: null },
    ]);

    await svc.run();

    expect(transportTask.changeStatus).not.toHaveBeenCalled();
  });
});

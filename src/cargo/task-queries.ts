import { In, Repository } from 'typeorm';
import {
  TaskStatus,
  TransportTaskEntity,
} from './entities/transport-task.entity';

const ACTIVE_TASK_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

export async function activeCargoVehicleNames(
  taskRepo: Repository<TransportTaskEntity>,
): Promise<Set<string>> {
  const tasks = await taskRepo.find({
    where: { status: In(ACTIVE_TASK_STATUSES) },
  });
  const names = new Set<string>();
  for (const task of tasks) {
    const name = task.metadata?.assignedVehicleName;
    if (name) names.add(name);
  }
  return names;
}

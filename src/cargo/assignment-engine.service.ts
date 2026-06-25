import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
  TASK_META,
} from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';

const ASSIGNED_VEHICLE = 'Vehicle-0001';

const BUSY_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

@Injectable()
export class AssignmentEngineService {
  private readonly logger = new Logger(AssignmentEngineService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly kernelApi: KernelApiService,
  ) {}

  async run(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.READY_TO_ASSIGN },
    });

    if (tasks.length === 0) return;

    for (const task of tasks) {
      const isBusy = await this.isVehicleBusy(ASSIGNED_VEHICLE);
      if (isBusy) {
        break;
      }
      await this.assign(task);
    }
  }

  private async isVehicleBusy(vehicleName: string): Promise<boolean> {
    const count = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.ASSIGNED_VEHICLE_NAME}' = :vehicle`, {
        vehicle: vehicleName,
      })
      .andWhere('t.status IN (:...statuses)', { statuses: BUSY_STATUSES })
      .getCount();
    return count > 0;
  }

  private async assign(task: TransportTaskEntity): Promise<void> {
    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;

    if (!cargo?.sourcePickupLocationName || !cargo?.destinationLocationName) {
      this.logger.warn(`Task ${task.id} missing location names — skipping`);
      return;
    }

    const to1Name = `TO1-${task.id}`;
    try {
      await this.kernelApi.createTransportOrder(
        to1Name,
        [
          {
            locationName: cargo.sourcePickupLocationName,
            operation: 'PICK_UP',
          },
        ],
        ASSIGNED_VEHICLE,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create TO1 for task ${task.id}: ${(err as Error).message}`,
      );
      return;
    }

    task.status = TaskStatus.PICKING_UP;
    task.assignedAt = new Date();
    task.startedAt = new Date();
    task.metadata = {
      ...task.metadata,
      assignedVehicleName: ASSIGNED_VEHICLE,
      to1Name,
    };
    await this.taskRepo.save(task);
    this.logger.log(`Task ${task.id} → PICKING_UP (${to1Name})`);
  }
}

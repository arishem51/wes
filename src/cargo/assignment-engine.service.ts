import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';

const ASSIGNED_VEHICLE = 'Vehicle-0001';

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

  @Interval(10_000)
  async run(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.READY_TO_ASSIGN },
    });

    if (tasks.length === 0) return;

    for (const task of tasks) {
      await this.assign(task);
    }
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

    task.status = TaskStatus.IN_FLIGHT;
    task.assignedAt = new Date();
    task.startedAt = new Date();
    task.metadata = {
      ...task.metadata,
      assignedVehicleName: ASSIGNED_VEHICLE,
      to1Name,
    };
    await this.taskRepo.save(task);
    this.logger.log(`Task ${task.id} → IN_FLIGHT (${to1Name})`);
  }
}

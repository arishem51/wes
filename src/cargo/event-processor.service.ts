import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly kernelApi: KernelApiService,
  ) {}

  @Interval(10_000)
  async poll(): Promise<void> {
    await Promise.all([
      this.checkInFlightTasks(),
      this.checkPickupCompletedTasks(),
    ]);
  }

  private async checkInFlightTasks(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.IN_FLIGHT },
    });

    for (const task of tasks) {
      const to1Name = task.metadata?.to1Name;
      if (!to1Name) continue;

      const state = await this.kernelApi.getTransportOrderState(to1Name);
      if (state !== 'FINISHED') continue;

      const cargo = task.cargoId
        ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
        : null;

      if (!cargo?.destinationLocationName) {
        this.logger.warn(
          `Task ${task.id} missing destination — marking FAILED`,
        );
        task.status = TaskStatus.FAILED;
        await this.taskRepo.save(task);
        continue;
      }

      const to2Name = `TO2-${task.id}`;
      const vehicle = task.metadata?.assignedVehicleName ?? 'Vehicle-0001';

      try {
        await this.kernelApi.createTransportOrder(
          to2Name,
          [
            {
              locationName: cargo.destinationLocationName,
              operation: 'DROP_OFF',
            },
          ],
          vehicle,
        );
      } catch (err) {
        this.logger.error(
          `Failed to create TO2 for task ${task.id}: ${(err as Error).message}`,
        );
        continue;
      }

      task.status = TaskStatus.PICKUP_COMPLETED;
      task.metadata = { ...task.metadata, to2Name };
      await this.taskRepo.save(task);
      this.logger.log(`Task ${task.id} → PICKUP_COMPLETED, created ${to2Name}`);
    }
  }

  private async checkPickupCompletedTasks(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.PICKUP_COMPLETED },
    });

    for (const task of tasks) {
      const to2Name = task.metadata?.to2Name;
      if (!to2Name) continue;

      const state = await this.kernelApi.getTransportOrderState(to2Name);
      if (state !== 'FINISHED') continue;

      task.status = TaskStatus.DELIVERY_COMPLETED;
      task.completedAt = new Date();
      await this.taskRepo.save(task);

      if (task.cargoId) {
        await this.cargoRepo.update(task.cargoId, {
          status: CargoStatus.DELIVERED,
        });
      }
      this.logger.log(`Task ${task.id} → DELIVERY_COMPLETED`);
    }
  }
}

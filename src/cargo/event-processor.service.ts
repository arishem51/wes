import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
  TASK_META,
} from './entities/transport-task.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { DispatchSchedulerService } from './dispatch-scheduler.service';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly dispatchScheduler: DispatchSchedulerService,
  ) {}

  async onPickUpToFinished(toName: string): Promise<void> {
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.TO1_NAME}' = :name`, { name: toName })
      .andWhere('t.status = :status', { status: TaskStatus.PROCESSING })
      .getOne();

    if (!task) {
      this.logger.debug(`No PROCESSING task found for TO1 "${toName}"`);
      return;
    }

    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;

    if (!cargo?.destinationLocationName) {
      this.logger.warn(`Task ${task.id} missing destination — marking FAILED`);
      task.status = TaskStatus.FAILED;
      await this.taskRepo.save(task);
      return;
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
      return;
    }

    task.status = TaskStatus.PICKUP_COMPLETED;
    task.metadata = { ...task.metadata, to2Name };
    await this.taskRepo.save(task);
    this.logger.log(`Task ${task.id} → PICKUP_COMPLETED, created ${to2Name}`);
  }

  async onDropOffToFinished(toName: string): Promise<void> {
    const task = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.metadata->>'${TASK_META.TO2_NAME}' = :name`, { name: toName })
      .andWhere('t.status = :status', { status: TaskStatus.PICKUP_COMPLETED })
      .getOne();

    if (!task) {
      this.logger.debug(`No PICKUP_COMPLETED task found for TO2 "${toName}"`);
      return;
    }

    task.status = TaskStatus.DELIVERY_COMPLETED;
    task.completedAt = new Date();
    await this.taskRepo.save(task);

    if (task.cargoId) {
      await this.cargoRepo.update(task.cargoId, {
        status: CargoStatus.DELIVERED,
      });
    }
    this.logger.log(`Task ${task.id} → DELIVERY_COMPLETED`);
    this.dispatchScheduler.schedule();
  }
}

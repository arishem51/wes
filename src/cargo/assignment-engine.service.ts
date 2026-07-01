import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransportTaskEntity, TaskStatus } from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';

/**
 * Turns READY_TO_ASSIGN tasks into OpenTCS transport orders.
 *
 * Option C: WES no longer picks the vehicle or the route. It creates ONE merged
 * order per task — PICK_UP at the source, DROP_OFF at the destination — WITHOUT
 * an intended vehicle. The kernel's dispatcher assigns a free vehicle and the
 * in-kernel MAPF router (FMSRouter) computes the collision-free route. Extra
 * orders simply queue in the kernel until a vehicle frees up.
 */
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
    for (const task of tasks) {
      await this.dispatch(task);
    }
  }

  private async dispatch(task: TransportTaskEntity): Promise<void> {
    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;

    if (!cargo?.sourcePickupLocationName || !cargo?.destinationLocationName) {
      this.logger.warn(`Task ${task.id} missing location names — skipping`);
      return;
    }

    const orderName = `TASK-${task.id}`;
    try {
      // One merged order; no intendedVehicle → kernel assigns + MAPF routes.
      await this.kernelApi.createTransportOrder(orderName, [
        { locationName: cargo.sourcePickupLocationName, operation: 'PICK_UP' },
        { locationName: cargo.destinationLocationName, operation: 'DROP_OFF' },
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to create order for task ${task.id}: ${(err as Error).message}`,
      );
      return;
    }

    task.status = TaskStatus.PICKING_UP;
    task.assignedAt = new Date();
    task.startedAt = new Date();
    task.metadata = { ...task.metadata, orderName };
    await this.taskRepo.save(task);
    this.logger.log(`Task ${task.id} → dispatched as ${orderName} (kernel-assigned + MAPF)`);
  }
}

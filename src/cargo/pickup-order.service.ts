import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { CargoEntity } from './entities/cargo.entity';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { ORDER_PROP } from './domain/events';
import { ORDER_TYPE, buildOrderName } from './domain/transport-order-name';
import type { DispatchMeasurement } from './assignment-engine.types';

@Injectable()
export class PickupOrderService {
  private readonly logger = new Logger(PickupOrderService.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
  ) {}

  async issue(
    task: TransportTaskEntity,
    cargo: CargoEntity | null,
    vehicleName: string,
    distanceToSource: number | null,
    measurement: DispatchMeasurement,
  ): Promise<boolean> {
    if (!cargo?.sourcePickupLocationName) {
      this.logger.warn(`Task ${task.id} missing pickup location — skipping`);
      return false;
    }

    const to1Name = buildOrderName(
      ORDER_TYPE.PICKUP,
      vehicleName,
      cargo.sourcePickupLocationName,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        to1Name,
        [
          {
            locationName: cargo.sourcePickupLocationName,
            operation: this.kernelApi.loadOperation,
          },
        ],
        vehicleName,
        { [ORDER_PROP.TASK_ID]: task.id, [ORDER_PROP.LEG]: 'PICKUP' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to create TO1 for task ${task.id}: ${(err as Error).message}`,
      );
      return false;
    }

    task.assignedAt = new Date();
    task.startedAt = new Date();
    task.metadata = {
      ...task.metadata,
      assignedVehicleName: vehicleName,
      to1Name,
    };
    await this.transportTask.changeStatus(task, TaskStatus.PICKING_UP, {
      trigger: 'ASSIGNMENT_ENGINE',
      vehicleName,
      context: { to1Name, distanceToSource, ...measurement },
    });
    this.logger.log(
      `Task ${task.id} → PICKING_UP on ${vehicleName} (${to1Name})`,
    );
    return true;
  }

  async revoke(
    task: TransportTaskEntity,
    toVehicleName: string,
  ): Promise<boolean> {
    const to1Name = task.metadata?.to1Name;
    const fromVehicleName = task.metadata?.assignedVehicleName ?? null;

    if (to1Name) {
      try {
        await this.kernelApi.withdrawTransportOrder(to1Name, false);
      } catch (err) {
        this.logger.error(
          `Failed to withdraw ${to1Name} for task ${task.id}: ${(err as Error).message}`,
        );
        return false;
      }
    }

    const swapCount = (task.metadata?.swapCount ?? 0) + 1;
    task.metadata = {
      ...task.metadata,
      to1Name: undefined,
      assignedVehicleName: undefined,
      swapCount,
    };
    task.assignedAt = null;
    task.startedAt = null;
    await this.transportTask.changeStatus(task, TaskStatus.READY_TO_ASSIGN, {
      trigger: 'ASSIGNMENT_ENGINE',
      vehicleName: fromVehicleName,
      context: {
        swap: true,
        swapCount,
        fromVehicleName,
        toVehicleName,
        withdrawnOrder: to1Name ?? null,
      },
    });
    this.logger.log(
      `Task ${task.id} SWAP ${fromVehicleName ?? '?'} → ${toVehicleName} (handover #${swapCount})`,
    );
    return true;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { ORDER_PROP } from './domain/events';
import { ORDER_TYPE, buildOrderName } from './domain/transport-order-name';
import { isSlotLocation, type ZoneSlotLayout } from './domain/zone-slot-layout';

export type ApproachTarget =
  | { readonly locationName: string }
  | { readonly pointName: string };

export function approachTargetFor(
  layout: ZoneSlotLayout,
  target: string,
): ApproachTarget {
  return isSlotLocation(layout, target)
    ? { locationName: target }
    : { pointName: target };
}

@Injectable()
export class ApproachOrderService {
  private readonly logger = new Logger(ApproachOrderService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    private readonly kernelApi: KernelApiService,
  ) {}

  async aim(
    task: TransportTaskEntity,
    vehicle: string,
    target: ApproachTarget,
  ): Promise<string | null> {
    const isLocation = 'locationName' in target;
    const destination = isLocation ? target.locationName : target.pointName;
    const operation = isLocation ? 'NOP' : 'MOVE';

    if (task.metadata?.approachPointName === destination) {
      return task.metadata.approachOrderName ?? null;
    }

    const current = task.metadata?.approachOrderName;
    if (current) {
      try {
        await this.kernelApi.withdrawTransportOrder(current);
      } catch (err) {
        this.logger.error(
          `Task ${task.id}: could not withdraw ${current} before aiming at ${destination}: ${(err as Error).message}`,
        );
        return null;
      }
    }

    const orderName = buildOrderName(
      ORDER_TYPE.APPROACH,
      vehicle,
      destination,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: destination, operation }],
        vehicle,
        { [ORDER_PROP.TASK_ID]: task.id, [ORDER_PROP.LEG]: 'APPROACH' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to create ${orderName}: ${(err as Error).message}`,
      );
      await this.forgetApproachOrder(task);
      return null;
    }

    task.metadata = {
      ...task.metadata,
      approachOrderName: orderName,
      approachPointName: destination,
      approachedAt: undefined,
    };
    await this.taskRepo.save(task);
    this.logger.log(
      `Task ${task.id}: ${vehicle} now heading to ${destination}`,
    );
    return orderName;
  }

  async cancel(task: TransportTaskEntity): Promise<void> {
    const current = task.metadata?.approachOrderName;
    if (!current) return;

    try {
      await this.kernelApi.withdrawTransportOrder(current);
    } catch (err) {
      this.logger.error(
        `Task ${task.id}: could not withdraw ${current} — leaving the reference so it can be retried: ${(err as Error).message}`,
      );
      return;
    }

    task.metadata = {
      ...task.metadata,
      approachOrderName: undefined,
      approachPointName: undefined,
    };
    await this.taskRepo.save(task);
  }

  private async forgetApproachOrder(task: TransportTaskEntity): Promise<void> {
    if (!task.metadata?.approachOrderName) return;

    task.metadata = {
      ...task.metadata,
      approachOrderName: undefined,
      approachPointName: undefined,
    };
    await this.taskRepo.save(task);
    this.logger.error(
      `Task ${task.id}: withdrew its approach order but could not replace it — dropped the reference so the withdrawal cannot fail the task`,
    );
  }
}

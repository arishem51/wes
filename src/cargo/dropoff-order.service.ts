import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { TransportOrderDestination } from '../opentcs/domain/kernel-model';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { RetreatPointService } from './retreat-point.service';
import type { RetreatPlan } from './domain/retreat-point';
import { ORDER_PROP } from './domain/events';
import { ORDER_TYPE, buildOrderName } from './domain/transport-order-name';

@Injectable()
export class DropoffOrderService {
  private readonly logger = new Logger(DropoffOrderService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly retreatPoint: RetreatPointService,
  ) {}

  async issue(
    task: TransportTaskEntity,
    vehicle: string,
    slot: string,
    zone: ZoneEntity,
  ): Promise<string | null> {
    const plan = await this.retreatPoint.planFor(slot, zone);
    if (!plan) {
      this.logger.warn(
        `Task ${task.id}: no retreat point behind ${slot} — drop-off goes out without the retreat leg`,
      );
    }

    const orderName = buildOrderName(
      ORDER_TYPE.DROPOFF,
      vehicle,
      slot,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        destinationsFor(slot, plan, this.kernelApi.unloadOperation),
        vehicle,
        { [ORDER_PROP.TASK_ID]: task.id, [ORDER_PROP.LEG]: 'DROPOFF' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to create ${orderName}: ${(err as Error).message}`,
      );
      return null;
    }

    task.metadata = { ...task.metadata, to3Name: orderName };
    const retreatPoint = plan?.cells.at(-1);
    if (retreatPoint) task.metadata.retreatPointName = retreatPoint;
    await this.taskRepo.save(task);
    return orderName;
  }

  async reissue(
    task: TransportTaskEntity,
    vehicle: string,
    slot: string,
    zone: ZoneEntity,
  ): Promise<string | null> {
    const current = task.metadata?.to3Name;
    if (current) {
      try {
        await this.kernelApi.withdrawTransportOrder(current);
      } catch (err) {
        this.logger.error(
          `Task ${task.id}: could not withdraw ${current} before aiming at ${slot}: ${(err as Error).message}`,
        );
        return null;
      }
    }
    return this.issue(task, vehicle, slot, zone);
  }
}

export function retreatDestinations(
  plan: RetreatPlan | null,
): TransportOrderDestination[] {
  const cells = plan ? [...plan.cells] : [];
  if (plan?.egress) cells.push(plan.egress);
  return cells.map((cell) => ({ locationName: cell, operation: 'MOVE' }));
}

function destinationsFor(
  slot: string,
  plan: RetreatPlan | null,
  unloadOperation: string,
): TransportOrderDestination[] {
  return [
    { locationName: slot, operation: unloadOperation },
    ...retreatDestinations(plan),
  ];
}

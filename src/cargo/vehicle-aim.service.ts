import { Injectable, Logger } from '@nestjs/common';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import type { TransportTaskEntity } from './entities/transport-task.entity';
import type { ZoneSlotLayout } from './domain/zone-slot-layout';
import {
  ApproachOrderService,
  approachTargetFor,
} from './approach-order.service';
import { DropoffOrderService } from './dropoff-order.service';
import { SlotReservationService } from './slot-reservation.service';

export interface AimedVehicle {
  readonly task: TransportTaskEntity;
  readonly vehicle: string;
  readonly cargoId: string;
}

@Injectable()
export class VehicleAimService {
  private readonly logger = new Logger(VehicleAimService.name);

  constructor(
    private readonly slotReservation: SlotReservationService,
    private readonly approachOrder: ApproachOrderService,
    private readonly dropoffOrder: DropoffOrderService,
  ) {}

  async queueAt(
    aimed: AimedVehicle,
    zone: ZoneEntity,
    layout: ZoneSlotLayout,
    cell: string,
  ): Promise<boolean> {
    const orderName = await this.approachOrder.aim(
      aimed.task,
      aimed.vehicle,
      approachTargetFor(layout, cell),
    );
    if (!orderName) {
      this.logger.error(
        `Task ${aimed.task.id}: ${aimed.vehicle} has no order for ${cell} — leaving it where it was aimed`,
      );
      return false;
    }

    await this.slotReservation.aimAt(aimed.cargoId, cell, zone);
    return true;
  }

  async stopApproaching(aimed: AimedVehicle): Promise<void> {
    await this.approachOrder.cancel(aimed.task);
  }
  async dropAt(
    aimed: AimedVehicle,
    zone: ZoneEntity,
    slot: string,
    keptOwnReservation: boolean,
  ): Promise<boolean> {
    const { task, vehicle } = aimed;
    const orderName = await this.dropOffOrderFor(
      task,
      vehicle,
      zone,
      slot,
      keptOwnReservation,
    );
    if (!orderName) {
      await this.slotReservation.releaseCommit(aimed.cargoId, zone);
      this.logger.error(
        `Task ${task.id}: ${vehicle} got no drop-off order for ${slot} — released the slot so the lane stays open`,
      );
      return false;
    }

    if (this.shouldCancelApproach(task, slot)) {
      await this.approachOrder.cancel(task);
    }
    return true;
  }

  private shouldCancelApproach(
    task: TransportTaskEntity,
    slot: string,
  ): boolean {
    const heading = task.metadata?.approachPointName;

    const noApproachOrderToCancel = !heading;
    if (noApproachOrderToCancel) return false;

    const alreadyHeadingToThatCell = heading === slot;
    return !alreadyHeadingToThatCell;
  }

  private async dropOffOrderFor(
    task: TransportTaskEntity,
    vehicle: string,
    zone: ZoneEntity,
    slot: string,
    keptOwnReservation: boolean,
  ): Promise<string | null> {
    const current = task.metadata?.dropoffOrderName;
    if (!current) return this.dropoffOrder.issue(task, vehicle, slot, zone);
    if (keptOwnReservation) return current;
    return this.dropoffOrder.reissue(task, vehicle, slot, zone);
  }
}

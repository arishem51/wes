import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import { DeliverySlotEngine } from './delivery-slot.engine';
import { ZoneOccupancy } from './domain/zone-occupancy';
import { ZONE_EVENTS } from './domain/events';
import {
  queueDiagnosis,
  queueOfLane,
  whereToQueue,
} from './domain/dropoff-lane';
import {
  laneIndexOfTarget,
  type ZoneLane,
  type ZoneSlotLayout,
} from './domain/zone-slot-layout';

const OCCUPYING_STATUSES = [CargoStatus.ACTIVE, CargoStatus.DELIVERED];
const NO_SLOT_LOG_EVERY_MS = 30_000;

export interface DisplacedCargo {
  cargoId: string;
  lostSlot: string;
  replacementSlot: string | null;
}

export interface SlotCommitResult {
  slot: string;
  keptOwnReservation: boolean;
  displaced: DisplacedCargo | null;
}

export interface ClaimedCell {
  readonly previous: string | null;
}

export interface SlotCommitOptions {
  readonly blockedLocationNames: ReadonlySet<string>;
  readonly unstealableLocationNames: ReadonlySet<string>;
  readonly lane: ZoneLane;
}

@Injectable()
export class SlotReservationService {
  private readonly logger = new Logger(SlotReservationService.name);
  private readonly noSlotLoggedAt = new Map<string, number>();

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly deliverySlotEngine: DeliverySlotEngine,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private announceReleasedSlot(zoneId: string): void {
    this.eventEmitter.emit(ZONE_EVENTS.SLOT_RELEASED, { zoneId });
  }

  async reserve(cargoId: string, zone: ZoneEntity): Promise<string | null> {
    const layout = await this.deliverySlotEngine.layoutFor(zone);
    if (!layout) return null;

    return this.withZoneLock(zone, async (manager) => {
      const cargo = await manager.getRepository(CargoEntity).findOne({
        where: { id: cargoId },
      });
      if (!cargo) return null;
      if (cargo.destinationLocationName) return cargo.destinationLocationName;
      if (cargo.reservedLocationName) return cargo.reservedLocationName;

      const occupancy = ZoneOccupancy.of(
        await this.zoneCargos(manager, zone.id),
        layout,
      );
      const target = whereToQueue(layout, occupancy);
      if (!target) {
        this.logger.warn(
          [
            `Cargo ${cargoId}: zone "${zone.name}" offered nowhere to queue`,
            ...queueDiagnosis(layout, occupancy).map((lane) => `  — ${lane}`),
          ].join('\n'),
        );
        return null;
      }

      await this.writeReservation(manager, cargo, target);
      return target;
    });
  }

  async commit(
    cargoId: string,
    zone: ZoneEntity,
    options: SlotCommitOptions,
  ): Promise<SlotCommitResult | null> {
    const layout = await this.deliverySlotEngine.layoutFor(zone);
    if (!layout) return null;

    return this.withZoneLock(zone, async (manager) => {
      const cargo = await manager.getRepository(CargoEntity).findOne({
        where: { id: cargoId },
      });
      if (!cargo) return null;
      if (cargo.destinationLocationName) {
        return {
          slot: cargo.destinationLocationName,
          keptOwnReservation: true,
          displaced: null,
        };
      }

      const ownReservation = cargo.reservedLocationName;
      const zoneCargos = await this.zoneCargos(manager, zone.id);
      const occupancy = ZoneOccupancy.of(zoneCargos, layout);
      const chosen = this.chooseSlot(layout, occupancy, options);
      if (!chosen) {
        if (this.dueToRepeatNoSlot(cargoId)) {
          this.logger.debug(
            `Cargo ${cargoId}: zone "${zone.name}" offered no slot to commit yet`,
          );
        }
        return null;
      }
      this.noSlotLoggedAt.delete(cargoId);

      const holder = occupancy.holderOf(chosen, cargo);

      await this.writeCommit(manager, cargo, chosen);

      if (!holder) {
        return {
          slot: chosen,
          keptOwnReservation: ownReservation === chosen,
          displaced: null,
        };
      }

      const replacement = await this.reassign(
        manager,
        layout,
        zone,
        ZoneOccupancy.of(zoneCargos, layout),
        holder,
        cargo,
        chosen,
      );
      return {
        slot: chosen,
        keptOwnReservation: false,
        displaced: {
          cargoId: holder.id,
          lostSlot: chosen,
          replacementSlot: replacement,
        },
      };
    });
  }

  async release(cargoId: string, zoneId: string): Promise<void> {
    await this.dataSource
      .getRepository(CargoEntity)
      .update(cargoId, { reservedLocationName: null });
    this.announceReleasedSlot(zoneId);
  }

  async releaseCommit(cargoId: string, zone: ZoneEntity): Promise<void> {
    this.noSlotLoggedAt.delete(cargoId);
    await this.withZoneLock(zone, async (manager) => {
      const cargo = await manager
        .getRepository(CargoEntity)
        .findOne({ where: { id: cargoId } });
      if (!cargo?.destinationLocationName) return;

      const nextSeq = cargo.slotDecisionSeq + 1;
      await manager.getRepository(CargoEntity).update(cargo.id, {
        destinationLocationName: null,
        slotDecisionSeq: nextSeq,
      });
      cargo.destinationLocationName = null;
      cargo.slotDecisionSeq = nextSeq;
    });
    this.announceReleasedSlot(zone.id);
  }

  private dueToRepeatNoSlot(cargoId: string): boolean {
    const now = Date.now();
    const last = this.noSlotLoggedAt.get(cargoId);
    if (last !== undefined && now - last < NO_SLOT_LOG_EVERY_MS) return false;

    this.noSlotLoggedAt.set(cargoId, now);
    return true;
  }

  private chooseSlot(
    layout: ZoneSlotLayout,
    occupancy: ZoneOccupancy,
    options: SlotCommitOptions,
  ): string | null {
    const laneIndex = layout.lanes.indexOf(options.lane);
    if (laneIndex === -1) return null;

    const claims = occupancy.columnClaims();
    const queue = queueOfLane(layout, laneIndex, {
      finished: claims.finished,
      committed: new Set([
        ...claims.committed,
        ...options.blockedLocationNames,
        ...options.unstealableLocationNames,
      ]),
      reserved: new Set<string>(),
    });
    return queue.next('commit')?.locationName ?? null;
  }

  private async reassign(
    manager: EntityManager,
    layout: ZoneSlotLayout,
    zone: ZoneEntity,
    afterCommit: ZoneOccupancy,
    holder: CargoEntity,
    committer: CargoEntity,
    committedSlot: string,
  ): Promise<string | null> {
    const lane = layout.lanes[laneIndexOfTarget(layout, committedSlot) ?? -1];
    const ranked = this.deliverySlotEngine.rank(
      layout,
      afterCommit.claimedTargets(),
    );
    const replacementSlot = lane
      ? firstSlotInLane(ranked, lane)
      : (ranked[0]?.locationName ?? null);
    if (!replacementSlot) {
      this.logger.error(
        `Cargo ${holder.id}: lost ${committedSlot} to cargo ${committer.id} and zone "${zone.name}" has nothing left`,
      );
      await this.writeReservation(manager, holder, null);
      return null;
    }

    await this.writeReservation(manager, holder, replacementSlot);
    return replacementSlot;
  }

  async claimCell(
    cargoId: string,
    target: string,
    zone: ZoneEntity,
  ): Promise<ClaimedCell | null> {
    return this.withZoneLock(zone, async (manager) => {
      const repo = manager.getRepository(CargoEntity);
      const cargo = await repo.findOne({ where: { id: cargoId } });
      if (!cargo || cargo.destinationLocationName) return null;
      if (cargo.reservedLocationName === target) return { previous: target };

      const holder = await repo.findOne({
        where: { status: CargoStatus.ACTIVE, reservedLocationName: target },
      });
      if (holder && holder.id !== cargoId) return null;

      const previous = cargo.reservedLocationName;
      await this.writeReservation(manager, cargo, target);
      return { previous };
    });
  }

  async restoreClaim(
    cargoId: string,
    target: string | null,
    zone: ZoneEntity,
  ): Promise<void> {
    await this.withZoneLock(zone, async (manager) => {
      const cargo = await manager
        .getRepository(CargoEntity)
        .findOne({ where: { id: cargoId } });
      if (!cargo || cargo.destinationLocationName) return;
      await this.writeReservation(manager, cargo, target);
    });
  }

  private async writeReservation(
    manager: EntityManager,
    cargo: CargoEntity,
    slot: string | null,
  ): Promise<void> {
    const nextSeq = cargo.slotDecisionSeq + 1;
    await manager.getRepository(CargoEntity).update(cargo.id, {
      reservedLocationName: slot,
      slotDecisionSeq: nextSeq,
    });
    cargo.reservedLocationName = slot;
    cargo.slotDecisionSeq = nextSeq;
  }

  private async writeCommit(
    manager: EntityManager,
    cargo: CargoEntity,
    slot: string,
  ): Promise<void> {
    const nextSeq = cargo.slotDecisionSeq + 1;
    await manager.getRepository(CargoEntity).update(cargo.id, {
      destinationLocationName: slot,
      reservedLocationName: null,
      slotDecisionSeq: nextSeq,
    });
    cargo.destinationLocationName = slot;
    cargo.reservedLocationName = null;
    cargo.slotDecisionSeq = nextSeq;
  }

  private zoneCargos(
    manager: EntityManager,
    zoneId: string,
  ): Promise<CargoEntity[]> {
    return manager.getRepository(CargoEntity).find({
      where: { destinationZoneId: zoneId, status: In(OCCUPYING_STATUSES) },
    });
  }

  private async withZoneLock<T>(
    zone: ZoneEntity,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [zone.id],
      );
      return work(manager);
    });
  }
}

function firstSlotInLane(
  ranked: readonly { locationName: string }[],
  lane: ZoneLane,
): string | null {
  const laneSlots = new Set(lane.slots.map((slot) => slot.locationName));
  return (
    ranked.find((slot) => laneSlots.has(slot.locationName))?.locationName ??
    null
  );
}

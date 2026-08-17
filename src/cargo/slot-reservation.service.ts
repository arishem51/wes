import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import { DeliverySlotEngine } from './delivery-slot.engine';
import {
  columnLocationNames,
  type ZoneSlotLayout,
} from './domain/zone-slot-layout';

const OCCUPYING_STATUSES = [CargoStatus.ACTIVE, CargoStatus.DELIVERED];

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

export interface SlotCommitOptions {
  readonly allowSwap: boolean;
  readonly insideColumnByCargoId: ReadonlyMap<string, number>;
}

@Injectable()
export class SlotReservationService {
  private readonly logger = new Logger(SlotReservationService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly deliverySlotEngine: DeliverySlotEngine,
  ) {}

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

      const zoneCargos = await this.zoneCargos(manager, zone.id);
      const claimed = claimedSlots(zoneCargos);
      const slot = this.deliverySlotEngine.rank(layout, claimed)[0];
      if (!slot) {
        this.logger.warn(
          `Cargo ${cargoId}: zone "${zone.name}" offered no slot to reserve`,
        );
        return null;
      }

      await this.writeReservation(manager, cargo, slot.locationName);
      return slot.locationName;
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
      const chosen = this.chooseSlot(layout, zoneCargos, cargo, options);
      if (!chosen) {
        this.logger.warn(
          `Cargo ${cargoId}: zone "${zone.name}" offered no slot to commit`,
        );
        return null;
      }

      const holder = zoneCargos.find(
        (other) =>
          other.id !== cargo.id &&
          other.reservedLocationName === chosen &&
          !other.destinationLocationName,
      );

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
        holder,
        zoneCargos,
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

  async release(cargoId: string): Promise<void> {
    await this.dataSource
      .getRepository(CargoEntity)
      .update(cargoId, { reservedLocationName: null });
  }

  private chooseSlot(
    layout: ZoneSlotLayout,
    zoneCargos: readonly CargoEntity[],
    cargo: CargoEntity,
    options: SlotCommitOptions,
  ): string | null {
    const untouchable = untouchableSlots(
      zoneCargos,
      cargo,
      options.insideColumnByCargoId,
    );
    const ranked = this.deliverySlotEngine.rank(layout, untouchable);
    if (ranked.length === 0) return null;

    if (options.allowSwap) return ranked[0].locationName;

    const own = cargo.reservedLocationName;
    if (own && !untouchable.has(own)) return own;

    const ownColumn = options.insideColumnByCargoId.get(cargo.id);
    if (ownColumn == null) return ranked[0].locationName;

    const ownColumnSlots = columnLocationNames(layout, ownColumn);
    return (
      ranked.find((slot) => ownColumnSlots.has(slot.locationName))
        ?.locationName ?? null
    );
  }

  private async reassign(
    manager: EntityManager,
    layout: ZoneSlotLayout,
    zone: ZoneEntity,
    holder: CargoEntity,
    zoneCargos: readonly CargoEntity[],
    committer: CargoEntity,
    committedSlot: string,
  ): Promise<string | null> {
    const claimed = committedSlots(zoneCargos);
    claimed.add(committedSlot);
    for (const other of zoneCargos) {
      if (other.id === holder.id || other.id === committer.id) continue;
      if (other.reservedLocationName) claimed.add(other.reservedLocationName);
    }

    const replacement = this.deliverySlotEngine.rank(layout, claimed)[0];
    if (!replacement) {
      this.logger.error(
        `Cargo ${holder.id}: lost ${committedSlot} to cargo ${committer.id} and zone "${zone.name}" has nothing left`,
      );
      await this.writeReservation(manager, holder, null);
      return null;
    }

    await this.writeReservation(manager, holder, replacement.locationName);
    return replacement.locationName;
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

function committedSlots(cargos: readonly CargoEntity[]): Set<string> {
  const slots = new Set<string>();
  for (const cargo of cargos) {
    if (cargo.destinationLocationName) slots.add(cargo.destinationLocationName);
  }
  return slots;
}

function untouchableSlots(
  cargos: readonly CargoEntity[],
  committer: CargoEntity,
  insideColumnByCargoId: ReadonlyMap<string, number>,
): Set<string> {
  const slots = committedSlots(cargos);
  for (const cargo of cargos) {
    if (cargo.id === committer.id) continue;
    if (!cargo.reservedLocationName) continue;
    if (!insideColumnByCargoId.has(cargo.id)) continue;
    slots.add(cargo.reservedLocationName);
  }
  return slots;
}

function claimedSlots(cargos: readonly CargoEntity[]): Set<string> {
  const slots = committedSlots(cargos);
  for (const cargo of cargos) {
    if (cargo.reservedLocationName) slots.add(cargo.reservedLocationName);
  }
  return slots;
}

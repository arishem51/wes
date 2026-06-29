import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import type { ZoneEntity } from '../zones/entities/zone.entity';

const LOCATION_PREFIX = 'location_';
const GRID_ROUND = 1000;

interface PointCoords {
  x: number;
  y: number;
}

interface MemberSlot {
  locationName: string;
  x: number;
  y: number;
  columnKey: number;
}

@Injectable()
export class DeliverySlotEngine {
  private readonly logger = new Logger(DeliverySlotEngine.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
  ) {}

  async findSlot(zone: ZoneEntity): Promise<string | null> {
    if (!zone.members || zone.members.length === 0) {
      this.logger.warn(`findSlot: zone "${zone.name}" has no members`);
      return null;
    }

    const plantModel = (await this.kernelApi.getPlantModel()) as Record<
      string,
      unknown
    > | null;
    if (!plantModel) {
      this.logger.warn('findSlot: plant model unavailable');
      return null;
    }

    const rawPoints = Array.isArray(plantModel.points)
      ? (plantModel.points as Array<Record<string, unknown>>)
      : [];
    const rawPaths = Array.isArray(plantModel.paths)
      ? (plantModel.paths as Array<Record<string, unknown>>)
      : [];
    const rawLocations = Array.isArray(plantModel.locations)
      ? (plantModel.locations as Array<Record<string, unknown>>)
      : [];

    const pointMap = new Map<string, PointCoords>();
    for (const p of rawPoints) {
      if (typeof p.name !== 'string') continue;
      const pos = p.position as { x?: number; y?: number } | undefined;
      if (!pos) continue;
      pointMap.set(p.name, { x: pos.x ?? 0, y: pos.y ?? 0 });
    }

    // Build location → first linked point name from actual plant model links
    const locationPointMap = new Map<string, string>();
    for (const loc of rawLocations) {
      if (typeof loc.name !== 'string') continue;
      const links = loc.links;
      if (Array.isArray(links) && links.length > 0) {
        const first = links[0] as Record<string, unknown>;
        const pn =
          typeof first.pointName === 'string'
            ? first.pointName
            : typeof first.point === 'string'
              ? first.point
              : null;
        if (pn) locationPointMap.set(loc.name, pn);
      } else if (links && typeof links === 'object' && !Array.isArray(links)) {
        const firstKey = Object.keys(links)[0];
        if (firstKey) locationPointMap.set(loc.name, firstKey);
      }
    }

    const memberPointNames = new Set<string>(
      zone.members
        .map(
          (m) =>
            locationPointMap.get(m.locationName) ??
            this.locationToPointName(m.locationName),
        )
        .filter(Boolean),
    );

    this.logger.debug(
      `findSlot: zone="${zone.name}" members=${zone.members.length} points=${rawPoints.length} paths=${rawPaths.length} locations=${rawLocations.length} memberPointNames=[${[...memberPointNames].join(',')}]`,
    );

    // Aisle reference = source points of paths entering zone from outside
    const aisleRefCoords: PointCoords[] = [];
    for (const path of rawPaths) {
      const dest = path.destPointName as string | undefined;
      const src = path.srcPointName as string | undefined;
      if (!dest || !src) continue;
      if (memberPointNames.has(dest) && !memberPointNames.has(src)) {
        const srcCoords = pointMap.get(src);
        if (srcCoords) aisleRefCoords.push(srcCoords);
      }
    }

    if (aisleRefCoords.length === 0) {
      this.logger.warn(
        `Zone "${zone.name}": no external inbound paths found, falling back to first empty slot`,
      );
      const memberNames = zone.members.map((m) => m.locationName);
      const occupied = await this.cargoRepo.find({
        where: {
          destinationLocationName: In(memberNames),
          status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]),
        },
      });
      const occupiedSet = new Set(
        occupied.map((c) => c.destinationLocationName!),
      );
      return memberNames.find((n) => !occupiedSet.has(n)) ?? null;
    }

    const aisleCenter: PointCoords = {
      x: aisleRefCoords.reduce((s, p) => s + p.x, 0) / aisleRefCoords.length,
      y: aisleRefCoords.reduce((s, p) => s + p.y, 0) / aisleRefCoords.length,
    };

    const slots: MemberSlot[] = [];
    for (const member of zone.members) {
      const pointName =
        locationPointMap.get(member.locationName) ??
        this.locationToPointName(member.locationName);
      const coords = pointMap.get(pointName);
      if (!coords) {
        this.logger.warn(`No point for location "${member.locationName}"`);
        continue;
      }
      const dx = coords.x - aisleCenter.x;
      const dy = coords.y - aisleCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const columnKey = Math.round(dist / GRID_ROUND) * GRID_ROUND;
      slots.push({
        locationName: member.locationName,
        x: coords.x,
        y: coords.y,
        columnKey,
      });
    }

    const columnMap = new Map<number, MemberSlot[]>();
    for (const slot of slots) {
      if (!columnMap.has(slot.columnKey)) columnMap.set(slot.columnKey, []);
      columnMap.get(slot.columnKey)!.push(slot);
    }

    for (const col of columnMap.values()) {
      col.sort((a, b) => a.y - b.y || a.x - b.x);
    }

    // Descending distance → columns[0] = innermost, columns[N-1] = outermost
    const columns = [...columnMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, members]) => members);

    const memberNames = zone.members.map((m) => m.locationName);
    const occupied = await this.cargoRepo.find({
      where: {
        destinationLocationName: In(memberNames),
        status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]),
      },
    });
    const occupiedSet = new Set(
      occupied.map((c) => c.destinationLocationName!),
    );

    const N = columns.length;
    const count = columns.map(
      (col) => col.filter((s) => occupiedSet.has(s.locationName)).length,
    );

    // Cascade: outermost always valid; column i valid if i+1 valid AND count[i]-count[i+1] <= 1
    const valid = new Array<boolean>(N).fill(false);
    valid[N - 1] = true;
    for (let i = N - 2; i >= 0; i--) {
      if (valid[i + 1] && count[i] - count[i + 1] <= 1) {
        valid[i] = true;
      }
    }

    const selectedIdx = valid.indexOf(true);
    this.logger.debug(
      `findSlot: slots=${slots.length} N=${N} count=[${count.join(',')}] valid=[${valid.join(',')}] selectedIdx=${selectedIdx}`,
    );
    if (selectedIdx === -1) return null;

    // Innermost valid column first; if full, try next valid column outward
    for (let i = selectedIdx; i < N; i++) {
      const emptySlot = columns[i].find(
        (s) => !occupiedSet.has(s.locationName),
      );
      if (emptySlot) return emptySlot.locationName;
    }
    return null;
  }

  async hasAvailableSlot(zone: ZoneEntity): Promise<boolean> {
    return (await this.findSlot(zone)) !== null;
  }

  private locationToPointName(locationName: string): string {
    return locationName.startsWith(LOCATION_PREFIX)
      ? locationName.slice(LOCATION_PREFIX.length)
      : locationName;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import {
  computeEgressPoints,
  hopsToExit,
  type PlantPath,
} from '../zones/domain/zone-topology';

const LOCATION_PREFIX = 'location_';

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
      ? (plantModel.paths as PlantPath[])
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

    // Exit reference = egress points (member → outside): where the flow leaves
    // the zone toward the exit. We fill slots FARTHEST from the exit first, so a
    // later drop never sits between an earlier one and the exit — physically the
    // parked cargo would block the vehicle, even though openTCS routing ignores
    // it.
    const egress = computeEgressPoints(rawPaths, memberPointNames);

    if (egress.length === 0) {
      this.logger.warn(
        `Zone "${zone.name}": no egress path found, falling back to first empty slot`,
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

    // Flow-hops from each slot to the exit; larger = farther from exit (filled
    // first). Slots with no path to the exit are dropped — a vehicle would be
    // stranded there.
    const hops = hopsToExit(rawPaths, memberPointNames, egress);

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
      const h = hops.get(pointName);
      if (h == null) {
        this.logger.warn(
          `Slot "${member.locationName}" cannot reach the exit — skipping`,
        );
        continue;
      }
      slots.push({
        locationName: member.locationName,
        x: coords.x,
        y: coords.y,
        columnKey: h,
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

    // Descending hops-to-exit → columns[0] = farthest from exit (fill first),
    // columns[N-1] = nearest the exit (fill last).
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

    // Cascade: nearest-exit column always valid; a farther column i is valid if
    // the next-nearer one (i+1) is valid AND count[i]-count[i+1] <= 1
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

    // Farthest-from-exit valid column first; if full, try the next nearer one
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

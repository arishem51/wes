import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import { resolveLocationPoints } from '../zones/domain/member-points';
import { computeEgressPoints, hopsToExit } from '../zones/domain/zone-topology';

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

    const plantModel = await this.kernelApi.getPlantModelView();
    if (!plantModel) {
      this.logger.warn('findSlot: plant model unavailable');
      return null;
    }

    const pointMap = new Map<string, PointCoords>(
      plantModel.points.map((point) => [point.name, point.position]),
    );

    const memberPoints = resolveLocationPoints(
      plantModel.locations,
      zone.members.map((member) => member.locationName),
    );
    const memberPointNames = new Set<string>(memberPoints.values());

    this.logger.debug(
      `findSlot: zone="${zone.name}" members=${zone.members.length} points=${plantModel.points.length} paths=${plantModel.paths.length} locations=${plantModel.locations.length} memberPointNames=[${[...memberPointNames].join(',')}]`,
    );

    const egress = computeEgressPoints(plantModel.paths, memberPointNames);

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
    const hops = hopsToExit(plantModel.paths, memberPointNames, egress);

    const slots: MemberSlot[] = [];
    for (const member of zone.members) {
      const pointName = memberPoints.get(member.locationName);
      const coords = pointName ? pointMap.get(pointName) : undefined;
      if (!pointName || !coords) {
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
}

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { ZoneEntity, ZoneStatus, ZoneType } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { CreateZoneDto } from './zone.dto';

export const LOCATION_PREFIX = 'location_';
export const ZONE_PREFIX = 'zone_';

export interface SyncResult {
  total: number;
  markedStale: number;
  markedActive: number;
  kernelUnreachable: boolean;
}

@Injectable()
export class ZoneService {
  private readonly logger = new Logger(ZoneService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectRepository(ZoneMemberEntity)
    private readonly memberRepo: Repository<ZoneMemberEntity>,
    private readonly kernelApi: KernelApiService,
  ) {}

  async create(dto: CreateZoneDto): Promise<ZoneEntity> {
    this.validateMembers(dto);

    let kernelId: number | null = null;

    if (dto.type === ZoneType.DROPOFF) {
      // Atomically generate a unique sequential kernel ID via PostgreSQL sequence
      const rows = await this.dataSource.query<[{ id: string }]>(
        `SELECT nextval('zone_kernel_id_seq') AS id`,
      );
      kernelId = Number(rows[0].id);
    }

    const zone = this.zoneRepo.create({
      name: dto.name,
      type: dto.type,
      kernelId,
      approachLocationName:
        kernelId != null ? `${ZONE_PREFIX}${kernelId}` : null,
      status: ZoneStatus.ACTIVE,
    });

    const saved = await this.zoneRepo.save(zone);

    const members = dto.members.map((m) =>
      this.memberRepo.create({
        zoneId: saved.id,
        locationName: m.locationName,
        positionIndex: m.positionIndex,
      }),
    );
    await this.memberRepo.save(members);

    if (dto.type === ZoneType.DROPOFF) {
      await this.applyDropoffZoneToKernel(
        `${ZONE_PREFIX}${kernelId}`,
        dto.members.map((m) => m.locationName),
      );
    }

    return this.zoneRepo.findOneOrFail({
      where: { id: saved.id },
      relations: { members: true },
    });
  }

  private async applyDropoffZoneToKernel(
    parentLocationName: string,
    memberLocationNames: string[],
  ): Promise<void> {
    const state = await this.kernelApi.getKernelState();
    if (state !== 'MODELLING') {
      throw new BadRequestException(
        'Kernel phải ở chế độ Thiết kế để tạo khu vực trả hàng. Hãy chuyển chế độ trước.',
      );
    }

    const rawModel = await this.kernelApi.getPlantModel();
    if (!rawModel || typeof rawModel !== 'object') {
      throw new ServiceUnavailableException('Không thể kết nối kernel.');
    }

    const model = rawModel as Record<string, unknown>;
    const locations = Array.isArray(model['locations'])
      ? (model['locations'] as Record<string, unknown>[])
      : [];

    const sampleDropoff = locations.find(
      (l) => (l['typeName'] ?? l['type']) === 'Drop off',
    );
    const useTypeNameKey =
      !sampleDropoff || 'typeName' in sampleDropoff ? 'typeName' : 'type';
    const useArrayLinks =
      !sampleDropoff || Array.isArray(sampleDropoff['links']);

    const buildLinks = (pointNames: string[]) =>
      useArrayLinks
        ? pointNames.map((pt) => ({ pointName: pt }))
        : Object.fromEntries(pointNames.map((pt) => [pt, []]));

    const kernelPoints = Array.isArray(model['points'])
      ? (model['points'] as Record<string, unknown>[])
      : [];

    const updatedLocations = [...locations];
    const parentLinkedPoints: string[] = [];
    let sumX = 0,
      sumY = 0,
      count = 0;

    for (const locName of memberLocationNames) {
      const pointName = locName.startsWith(LOCATION_PREFIX)
        ? locName.slice(LOCATION_PREFIX.length)
        : locName;

      const point = kernelPoints.find((p) => p['name'] === pointName);
      const pos = point?.['position'] as Record<string, number> | undefined;
      const px = pos?.['x'] ?? 0;
      const py = pos?.['y'] ?? 0;

      if (pos) {
        sumX += px;
        sumY += py;
        count++;
      }

      const childLocation: Record<string, unknown> = {
        name: locName,
        [useTypeNameKey]: 'Drop off',
        position: { x: px, y: py, z: 0 },
        locked: false,
        links: buildLinks([pointName]),
      };
      if (sampleDropoff?.['layout']) {
        childLocation['layout'] = { ...sampleDropoff['layout'] };
      }

      const idx = updatedLocations.findIndex((l) => l['name'] === locName);
      if (idx >= 0) {
        updatedLocations[idx] = childLocation;
      } else {
        updatedLocations.push(childLocation);
      }

      if (!parentLinkedPoints.includes(pointName)) {
        parentLinkedPoints.push(pointName);
      }
    }

    const centroidX = count > 0 ? Math.round(sumX / count) : 0;
    const centroidY = count > 0 ? Math.round(sumY / count) : 0;

    const parentLocation: Record<string, unknown> = {
      name: parentLocationName,
      [useTypeNameKey]: 'Drop off',
      position: { x: centroidX, y: centroidY, z: 0 },
      locked: false,
      links: buildLinks(parentLinkedPoints),
    };
    if (sampleDropoff?.['layout']) {
      parentLocation['layout'] = { ...sampleDropoff['layout'] };
    }

    const parentIdx = updatedLocations.findIndex(
      (l) => l['name'] === parentLocationName,
    );
    if (parentIdx >= 0) {
      updatedLocations[parentIdx] = parentLocation;
    } else {
      updatedLocations.push(parentLocation);
    }

    await this.kernelApi.putRawPlantModel({
      ...model,
      locations: updatedLocations,
    });
    this.logger.log(
      `Zone "${parentLocationName}": created ${memberLocationNames.length} child locations + 1 parent location in kernel`,
    );
  }

  async list(): Promise<ZoneEntity[]> {
    return this.zoneRepo.find({
      relations: { members: true },
      order: { createdAt: 'DESC' },
    });
  }

  async sync(): Promise<SyncResult> {
    const model = await this.kernelApi.getLocationModel();

    if (!model) {
      this.logger.warn('Sync skipped: kernel unreachable');
      return {
        total: 0,
        markedStale: 0,
        markedActive: 0,
        kernelUnreachable: true,
      };
    }

    const kernelLocationNames = new Set(model.locations.map((l) => l.name));
    const zones = await this.zoneRepo.find({ relations: { members: true } });

    let markedStale = 0;
    let markedActive = 0;

    for (const zone of zones) {
      const isValid = this.isZoneValid(zone, kernelLocationNames);
      const targetStatus = isValid ? ZoneStatus.ACTIVE : ZoneStatus.STALE;

      if (zone.status !== targetStatus) {
        zone.status = targetStatus;
        await this.zoneRepo.save(zone);
        if (targetStatus === ZoneStatus.STALE) {
          markedStale++;
          this.logger.warn(`Zone "${zone.name}" (${zone.id}) marked STALE`);
        } else {
          markedActive++;
          this.logger.log(
            `Zone "${zone.name}" (${zone.id}) restored to ACTIVE`,
          );
        }
      }
    }

    return {
      total: zones.length,
      markedStale,
      markedActive,
      kernelUnreachable: false,
    };
  }

  private isZoneValid(zone: ZoneEntity, kernelLocations: Set<string>): boolean {
    const allMembersExist = zone.members.every((m) =>
      kernelLocations.has(m.locationName),
    );
    if (!allMembersExist) return false;

    if (zone.type === ZoneType.DROPOFF && zone.approachLocationName) {
      return kernelLocations.has(zone.approachLocationName);
    }

    return true;
  }

  private validateMembers(dto: CreateZoneDto): void {
    const locationNames = dto.members.map((m) => m.locationName);
    const uniqueNames = new Set(locationNames);
    if (uniqueNames.size !== locationNames.length) {
      throw new BadRequestException('Duplicate locationName in members.');
    }

    const positionIndexes = dto.members.map((m) => m.positionIndex);
    const uniqueIndexes = new Set(positionIndexes);
    if (uniqueIndexes.size !== positionIndexes.length) {
      throw new BadRequestException('Duplicate positionIndex in members.');
    }
  }
}

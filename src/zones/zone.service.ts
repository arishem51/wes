import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ZoneEntity, ZoneStatus, ZoneType } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { savePlantModel } from '../opentcs/save-plant-model';
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

    const savedZoneId = await this.dataSource.transaction(async (manager) => {
      const zoneRepo = manager.getRepository(ZoneEntity);
      const memberRepo = manager.getRepository(ZoneMemberEntity);

      let kernelId: number | null = null;

      if (dto.type === ZoneType.DROPOFF) {
        const rows = await manager.query<[{ id: string }]>(
          `SELECT nextval('zone_kernel_id_seq') AS id`,
        );
        kernelId = Number(rows[0].id);
      }

      const zone = zoneRepo.create({
        name: dto.name,
        type: dto.type,
        kernelId,
        approachLocationName:
          kernelId != null ? `${ZONE_PREFIX}${kernelId}` : null,
        status: ZoneStatus.ACTIVE,
      });

      const saved = await zoneRepo.save(zone);

      const members = dto.members.map((member) =>
        memberRepo.create({
          zoneId: saved.id,
          locationName: member.locationName,
          positionIndex: member.positionIndex,
        }),
      );
      await memberRepo.save(members);

      if (dto.type === ZoneType.DROPOFF) {
        await this.applyDropoffZoneToKernel(
          `${ZONE_PREFIX}${kernelId}`,
          dto.members.map((member) => member.locationName),
        );
      }

      return saved.id;
    });

    return this.zoneRepo.findOneOrFail({
      where: { id: savedZoneId },
      relations: { members: true },
    });
  }

  private async applyDropoffZoneToKernel(
    parentLocationName: string,
    memberLocationNames: string[],
  ): Promise<void> {
    const rawModel = await this.kernelApi.getPlantModel();
    if (!rawModel || typeof rawModel !== 'object') {
      throw new ServiceUnavailableException('Không thể kết nối kernel.');
    }

    const model = rawModel as Record<string, unknown>;
    const locations = Array.isArray(model.locations)
      ? (model.locations as Record<string, unknown>[])
      : [];

    const sampleDropoff = locations.find(
      (location) => (location.typeName ?? location.type) === 'Drop off',
    );
    const useTypeNameKey =
      !sampleDropoff || 'typeName' in sampleDropoff ? 'typeName' : 'type';
    const useArrayLinks = !sampleDropoff || Array.isArray(sampleDropoff.links);

    const buildLinks = (pointNames: string[]) =>
      useArrayLinks
        ? pointNames.map((pointName) => ({ pointName }))
        : Object.fromEntries(pointNames.map((pointName) => [pointName, []]));

    const kernelPoints = Array.isArray(model.points)
      ? (model.points as Record<string, unknown>[])
      : [];

    const updatedLocations = [...locations];
    const parentLinkedPoints: string[] = [];
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (const locName of memberLocationNames) {
      const pointName = locName.startsWith(LOCATION_PREFIX)
        ? locName.slice(LOCATION_PREFIX.length)
        : locName;

      const point = kernelPoints.find(
        (candidate) => candidate.name === pointName,
      );
      const pos = point?.position as Record<string, number> | undefined;
      const px = pos?.x ?? 0;
      const py = pos?.y ?? 0;

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
      if (sampleDropoff?.layout) {
        childLocation.layout = { ...sampleDropoff.layout };
      }

      const idx = updatedLocations.findIndex(
        (location) => location.name === locName,
      );
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
    if (sampleDropoff?.layout) {
      parentLocation.layout = { ...sampleDropoff.layout };
    }

    const parentIdx = updatedLocations.findIndex(
      (location) => location.name === parentLocationName,
    );
    if (parentIdx >= 0) {
      updatedLocations[parentIdx] = parentLocation;
    } else {
      updatedLocations.push(parentLocation);
    }

    await savePlantModel(this.kernelApi, {
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

    const kernelLocationNames = new Set(
      model.locations.map((location) => location.name),
    );
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
    const allMembersExist = zone.members.every((member) =>
      kernelLocations.has(member.locationName),
    );
    if (!allMembersExist) return false;

    if (zone.type === ZoneType.DROPOFF && zone.approachLocationName) {
      return kernelLocations.has(zone.approachLocationName);
    }

    return true;
  }

  private validateMembers(dto: CreateZoneDto): void {
    const locationNames = dto.members.map((member) => member.locationName);
    const uniqueNames = new Set(locationNames);
    if (uniqueNames.size !== locationNames.length) {
      throw new BadRequestException('Duplicate locationName in members.');
    }

    const positionIndexes = dto.members.map((member) => member.positionIndex);
    const uniqueIndexes = new Set(positionIndexes);
    if (uniqueIndexes.size !== positionIndexes.length) {
      throw new BadRequestException('Duplicate positionIndex in members.');
    }
  }
}

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

type KernelLocationType = 'Pick up' | 'Drop off';

type KernelLocationMeta = {
  useTypeNameKey: 'typeName' | 'type';
  useArrayLinks: boolean;
  layout?: Record<string, unknown>;
};

type KernelModelContext = {
  model: Record<string, unknown>;
  locations: Record<string, unknown>[];
  kernelPoints: Record<string, unknown>[];
  updatedLocations: Record<string, unknown>[];
};

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
      const memberLocationNames = dto.members.map(
        (member) => member.locationName,
      );

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
          memberLocationNames,
        );
      } else if (dto.type === ZoneType.PICKUP) {
        await this.applyPickupZoneToKernel(memberLocationNames);
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
    const context = await this.loadKernelModelContext();
    const locationMeta = this.getLocationMeta(context.locations, 'Drop off');
    const pointSummaries = this.upsertMemberLocations(
      context,
      memberLocationNames,
      'Drop off',
      locationMeta,
    );
    const parentLinkedPoints = [
      ...new Set(pointSummaries.map((p) => p.pointName)),
    ];
    const positionedPoints = pointSummaries.filter((p) => p.hasPosition);
    const sumX = positionedPoints.reduce((sum, point) => sum + point.x, 0);
    const sumY = positionedPoints.reduce((sum, point) => sum + point.y, 0);
    const count = positionedPoints.length;

    const parentLocation = this.buildKernelLocation(
      parentLocationName,
      'Drop off',
      parentLinkedPoints,
      {
        x: count > 0 ? Math.round(sumX / count) : 0,
        y: count > 0 ? Math.round(sumY / count) : 0,
        z: 0,
      },
      locationMeta,
    );
    this.upsertLocation(context.updatedLocations, parentLocation);

    await savePlantModel(this.kernelApi, {
      ...context.model,
      locations: context.updatedLocations,
    });
    this.logger.log(
      `Zone "${parentLocationName}": đã tạo ${memberLocationNames.length} location con và 1 location cha trong kernel`,
    );
  }

  private async applyPickupZoneToKernel(
    memberLocationNames: string[],
  ): Promise<void> {
    const context = await this.loadKernelModelContext();
    const locationMeta = this.getLocationMeta(context.locations, 'Pick up');
    this.upsertMemberLocations(
      context,
      memberLocationNames,
      'Pick up',
      locationMeta,
    );

    await savePlantModel(this.kernelApi, {
      ...context.model,
      locations: context.updatedLocations,
    });
    this.logger.log(
      `Zone lấy hàng: đã tạo ${memberLocationNames.length} location con trong kernel`,
    );
  }

  private async loadKernelModelContext(): Promise<KernelModelContext> {
    const rawModel = await this.kernelApi.getPlantModel();
    if (!rawModel || typeof rawModel !== 'object') {
      throw new ServiceUnavailableException('Không thể kết nối kernel.');
    }

    const model = rawModel as Record<string, unknown>;
    const locations = Array.isArray(model.locations)
      ? (model.locations as Record<string, unknown>[])
      : [];
    const kernelPoints = Array.isArray(model.points)
      ? (model.points as Record<string, unknown>[])
      : [];

    return {
      model,
      locations,
      kernelPoints,
      updatedLocations: [...locations],
    };
  }

  private upsertMemberLocations(
    context: KernelModelContext,
    memberLocationNames: string[],
    locationType: KernelLocationType,
    meta: KernelLocationMeta,
  ): Array<{ pointName: string; x: number; y: number; hasPosition: boolean }> {
    return memberLocationNames.map((locationName) => {
      const pointName = this.getPointNameFromLocation(locationName);
      const point = context.kernelPoints.find(
        (candidate) => candidate.name === pointName,
      );
      const position = point?.position as Record<string, number> | undefined;
      const x = position?.x ?? 0;
      const y = position?.y ?? 0;

      this.upsertLocation(
        context.updatedLocations,
        this.buildKernelLocation(
          locationName,
          locationType,
          [pointName],
          { x, y, z: 0 },
          meta,
        ),
      );

      return {
        pointName,
        x,
        y,
        hasPosition: !!position,
      };
    });
  }

  private getPointNameFromLocation(locationName: string): string {
    return locationName.startsWith(LOCATION_PREFIX)
      ? locationName.slice(LOCATION_PREFIX.length)
      : locationName;
  }

  private getLocationMeta(
    locations: Record<string, unknown>[],
    locationType: KernelLocationType,
  ): KernelLocationMeta {
    const sampleLocation = locations.find(
      (location) => (location.typeName ?? location.type) === locationType,
    );
    return {
      useTypeNameKey:
        !sampleLocation || 'typeName' in sampleLocation ? 'typeName' : 'type',
      useArrayLinks: !sampleLocation || Array.isArray(sampleLocation.links),
      layout:
        sampleLocation?.layout && typeof sampleLocation.layout === 'object'
          ? { ...(sampleLocation.layout as Record<string, unknown>) }
          : undefined,
    } as const;
  }

  private buildKernelLocation(
    name: string,
    locationType: KernelLocationType,
    pointNames: string[],
    position: { x: number; y: number; z: number },
    meta: {
      useTypeNameKey: 'typeName' | 'type';
      useArrayLinks: boolean;
      layout?: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const location: Record<string, unknown> = {
      name,
      [meta.useTypeNameKey]: locationType,
      position,
      locked: false,
      links: meta.useArrayLinks
        ? pointNames.map((pointName) => ({ pointName }))
        : Object.fromEntries(pointNames.map((pointName) => [pointName, []])),
    };

    if (meta.layout) {
      location.layout = { ...meta.layout };
    }

    return location;
  }

  private upsertLocation(
    locations: Record<string, unknown>[],
    location: Record<string, unknown>,
  ): void {
    const index = locations.findIndex((item) => item.name === location.name);
    if (index >= 0) {
      locations[index] = location;
    } else {
      locations.push(location);
    }
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

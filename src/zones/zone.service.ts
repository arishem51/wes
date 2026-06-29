import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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

type RuntimePlantModel = {
  pointNames: Set<string>;
  locations: Map<string, Set<string>>;
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

  async list(): Promise<
    Array<ZoneEntity & { occupiedSlotCount: number; totalSlotCount: number }>
  > {
    const zones = await this.zoneRepo.find({
      relations: { members: true },
      order: { createdAt: 'DESC' },
    });

    if (zones.length === 0) return [];

    const zoneIds = zones.map((z) => z.id);
    const rows = await this.dataSource.query<
      Array<{ zone_id: string; count: string }>
    >(
      `SELECT zm.zone_id, COUNT(c.id)::text AS count
       FROM zone_members zm
       INNER JOIN cargos c
         ON c.destination_location_name = zm.location_name
        AND c.status IN ('ACTIVE', 'DELIVERED')
        AND c.deleted_at IS NULL
       WHERE zm.zone_id = ANY($1)
       GROUP BY zm.zone_id`,
      [zoneIds],
    );

    const occupiedByZone = new Map(
      rows.map((r) => [r.zone_id, Number(r.count)]),
    );

    return zones.map((z) => ({
      ...z,
      occupiedSlotCount: occupiedByZone.get(z.id) ?? 0,
      totalSlotCount: z.members.length,
    }));
  }

  async remove(id: string): Promise<void> {
    const zone = await this.zoneRepo.findOne({
      where: { id },
      relations: { members: true },
    });
    if (!zone) {
      throw new NotFoundException('Khu vực không tồn tại.');
    }

    await this.removeZoneLocationsFromKernel(zone);
    await this.zoneRepo.softDelete(id);
  }

  async sync(): Promise<SyncResult> {
    const model = await this.loadRuntimePlantModel();

    if (!model) {
      this.logger.warn('Sync skipped: kernel unreachable');
      return {
        total: 0,
        markedStale: 0,
        markedActive: 0,
        kernelUnreachable: true,
      };
    }

    const zones = await this.zoneRepo.find({ relations: { members: true } });

    let markedStale = 0;
    let markedActive = 0;

    for (const zone of zones) {
      const isValid = this.isZoneValid(zone, model);
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

  private isZoneValid(zone: ZoneEntity, model: RuntimePlantModel): boolean {
    const expectedMemberPoints = new Set<string>();

    for (const member of zone.members) {
      const memberLinks = model.locations.get(member.locationName);
      if (!memberLinks) {
        return false;
      }

      const pointName = this.getPointNameFromLocation(member.locationName);
      if (!model.pointNames.has(pointName) || !memberLinks.has(pointName)) {
        return false;
      }

      expectedMemberPoints.add(pointName);
    }

    if (zone.type === ZoneType.DROPOFF && zone.approachLocationName) {
      const approachLinks = model.locations.get(zone.approachLocationName);
      if (!approachLinks || approachLinks.size === 0) {
        return false;
      }

      for (const pointName of approachLinks) {
        if (
          !model.pointNames.has(pointName) ||
          !expectedMemberPoints.has(pointName)
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private async loadRuntimePlantModel(): Promise<RuntimePlantModel | null> {
    const rawModel = await this.kernelApi.getPlantModel();
    if (!rawModel || typeof rawModel !== 'object') {
      return null;
    }

    const model = rawModel as Record<string, unknown>;
    const modelName = typeof model.name === 'string' ? model.name : null;
    const rawPoints = Array.isArray(model.points) ? model.points : [];
    const rawLocations = Array.isArray(model.locations) ? model.locations : [];
    const rawPaths = Array.isArray(model.paths) ? model.paths : [];
    const rawVehicles = Array.isArray(model.vehicles) ? model.vehicles : [];
    if (
      modelName === 'unnamed' &&
      rawPoints.length === 0 &&
      rawLocations.length === 0 &&
      rawPaths.length === 0 &&
      rawVehicles.length === 0
    ) {
      return null;
    }

    const pointNames = new Set(
      rawPoints
        .map((point) =>
          point &&
          typeof point === 'object' &&
          typeof (point as { name?: unknown }).name === 'string'
            ? (point as { name: string }).name
            : null,
        )
        .filter((name): name is string => name !== null),
    );
    const locations = new Map<string, Set<string>>();

    if (rawLocations.length > 0) {
      for (const location of rawLocations) {
        if (!location || typeof location !== 'object') {
          continue;
        }

        const { name } = location as { name?: unknown };
        if (typeof name !== 'string') {
          continue;
        }

        locations.set(
          name,
          this.extractLinkedPointNames((location as { links?: unknown }).links),
        );
      }
    }

    return { pointNames, locations };
  }

  private extractLinkedPointNames(links: unknown): Set<string> {
    if (Array.isArray(links)) {
      return new Set(
        links
          .map((link) =>
            link && typeof link === 'object'
              ? ((link as { pointName?: unknown }).pointName ??
                (link as { point?: unknown }).point)
              : null,
          )
          .filter(
            (pointName): pointName is string => typeof pointName === 'string',
          ),
      );
    }

    if (links && typeof links === 'object') {
      return new Set(Object.keys(links));
    }

    return new Set();
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

  private async removeZoneLocationsFromKernel(zone: ZoneEntity): Promise<void> {
    const context = await this.loadKernelModelContext();
    const removableNames = new Set<string>();
    const memberLocationNames = [
      ...new Set(zone.members.map((member) => member.locationName)),
    ];

    if (memberLocationNames.length > 0) {
      const sharedLocationRows = await this.dataSource.query<
        Array<{ location_name: string }>
      >(
        `
          SELECT DISTINCT zm.location_name
          FROM zone_members zm
          JOIN zones z ON z.id = zm.zone_id
          WHERE zm.zone_id <> $1
            AND z.deleted_at IS NULL
            AND zm.location_name = ANY($2)
        `,
        [zone.id, memberLocationNames],
      );
      const sharedLocationNames = new Set(
        sharedLocationRows.map((row) => row.location_name),
      );

      for (const locationName of memberLocationNames) {
        if (!sharedLocationNames.has(locationName)) {
          removableNames.add(locationName);
        }
      }
    }

    if (zone.type === ZoneType.DROPOFF && zone.approachLocationName) {
      removableNames.add(zone.approachLocationName);
    }

    if (removableNames.size === 0) {
      return;
    }

    const nextLocations = context.updatedLocations.filter((location) => {
      const name =
        typeof location.name === 'string' ? location.name : undefined;
      return !name || !removableNames.has(name);
    });

    await savePlantModel(this.kernelApi, {
      ...context.model,
      locations: nextLocations,
    });
    this.logger.log(`Zone "${zone.name}" (${zone.id}) soft-deleted`);
  }
}

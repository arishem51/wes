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
import type { CreateZoneDto, UpdateZoneDto } from './zone.dto';
import {
  checkZoneReachability,
  computeFeederPoints,
  type PlantPath,
} from './domain/zone-topology';

export const LOCATION_PREFIX = 'location_';
export const ZONE_PREFIX = 'zone_';

/**
 * Curated, contrast-safe hues used to color zones on the map. When an operator
 * creates a zone without picking a color we auto-assign the least-used hue so
 * two active zones never collide (and never land on a washed-out random value).
 */
export const ZONE_COLOR_PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
  '#ea580c', // orange
  '#0d9488', // teal
  '#9333ea', // purple
  '#ca8a04', // gold
  '#e11d48', // rose
  '#4f46e5', // indigo
  '#059669', // emerald
  '#c026d3', // fuchsia
  '#0284c7', // sky
  '#b45309', // bronze
  '#15803d', // pine
  '#be123c', // crimson
] as const;

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

    if (dto.type === ZoneType.DROPOFF) {
      await this.assertDropoffZoneReachable(
        dto.members.map((member) => member.locationName),
      );
    }

    const color = dto.color ?? (await this.pickDefaultColor());

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
        color,
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

  async update(id: string, dto: UpdateZoneDto): Promise<ZoneEntity> {
    const zone = await this.zoneRepo.findOne({
      where: { id },
      relations: { members: true },
    });
    if (!zone) {
      throw new NotFoundException('Khu vực không tồn tại.');
    }
    zone.color = dto.color;
    return this.zoneRepo.save(zone);
  }

  /**
   * Picks the palette hue least used by ACTIVE zones so a fresh zone stays
   * visually distinct. Ties resolve to palette order (deterministic).
   */
  private async pickDefaultColor(): Promise<string> {
    const zones = await this.zoneRepo.find({
      where: { status: ZoneStatus.ACTIVE },
      select: { id: true, color: true },
    });
    const usage = new Map<string, number>();
    for (const zone of zones) {
      if (zone.color) usage.set(zone.color, (usage.get(zone.color) ?? 0) + 1);
    }
    let best = ZONE_COLOR_PALETTE[0] as string;
    let bestCount = Infinity;
    for (const color of ZONE_COLOR_PALETTE) {
      const count = usage.get(color) ?? 0;
      if (count < bestCount) {
        bestCount = count;
        best = color;
      }
    }
    return best;
  }

  private async applyDropoffZoneToKernel(
    parentLocationName: string,
    memberLocationNames: string[],
  ): Promise<void> {
    const context = await this.loadKernelModelContext();
    this.appendDropoffZoneLocations(
      context,
      parentLocationName,
      memberLocationNames,
    );
    await savePlantModel(this.kernelApi, {
      ...context.model,
      locations: context.updatedLocations,
    });
    this.logger.log(
      `Zone "${parentLocationName}": đã tạo ${memberLocationNames.length} location con và 1 location cha trong kernel`,
    );
  }

  /**
   * Builds a dropoff zone's child locations + parent (`zone_<id>`) location and
   * upserts them into `context.updatedLocations`. Does NOT persist — callers save
   * the model, so several zones can be batched into one PUT.
   */
  private appendDropoffZoneLocations(
    context: KernelModelContext,
    parentLocationName: string,
    memberLocationNames: string[],
  ): void {
    const locationMeta = this.getLocationMeta(context.locations, 'Drop off');
    const pointSummaries = this.upsertMemberLocations(
      context,
      memberLocationNames,
      'Drop off',
      locationMeta,
    );
    const memberPointNames = new Set(pointSummaries.map((p) => p.pointName));
    // The parent `zone_<id>` location is the NOP approach target. Link it to the
    // zone's feeder points (aisle heads) — not every member — so the router
    // stops at the entry-most head, keeping all slots forward-reachable instead
    // of greedily stopping at the nearest member deep inside a lane (which forces
    // a detour on one-way maps). Fall back to all members if the map exposes no
    // external inbound path, so the parent never ends up with zero links.
    let parentLinkedPoints = computeFeederPoints(
      (context.model.paths as PlantPath[] | undefined) ?? [],
      memberPointNames,
    );
    if (parentLinkedPoints.length === 0) {
      this.logger.warn(
        `Zone "${parentLocationName}": no external inbound (feeder) path found — linking parent to all member points`,
      );
      parentLinkedPoints = [...memberPointNames];
    }
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
  }

  private async applyPickupZoneToKernel(
    memberLocationNames: string[],
  ): Promise<void> {
    const context = await this.loadKernelModelContext();
    this.appendPickupZoneLocations(context, memberLocationNames);
    await savePlantModel(this.kernelApi, {
      ...context.model,
      locations: context.updatedLocations,
    });
    this.logger.log(
      `Zone lấy hàng: đã tạo ${memberLocationNames.length} location con trong kernel`,
    );
  }

  /**
   * Builds a pickup zone's child locations and upserts them into
   * `context.updatedLocations` without persisting (see appendDropoffZoneLocations).
   */
  private appendPickupZoneLocations(
    context: KernelModelContext,
    memberLocationNames: string[],
  ): void {
    const locationMeta = this.getLocationMeta(context.locations, 'Pick up');
    this.upsertMemberLocations(
      context,
      memberLocationNames,
      'Pick up',
      locationMeta,
    );
  }

  private appendZoneLocations(
    context: KernelModelContext,
    zone: ZoneEntity,
  ): void {
    const memberLocationNames = this.zoneMemberLocationNames(zone);
    if (zone.type === ZoneType.DROPOFF && zone.approachLocationName) {
      this.appendDropoffZoneLocations(
        context,
        zone.approachLocationName,
        memberLocationNames,
      );
    } else {
      this.appendPickupZoneLocations(context, memberLocationNames);
    }
  }

  /**
   * A zone can be rebuilt onto the current kernel map only if every member's
   * underlying point still exists (locations are derived from points). A dropoff
   * zone additionally needs its parent identity (`approachLocationName`). Missing
   * *location* is what we repair; missing *point* is unrepairable.
   */
  private canRepairZone(
    zone: ZoneEntity,
    kernelPointNames: Set<string>,
  ): boolean {
    if (zone.members.length === 0) return false;
    if (zone.type === ZoneType.DROPOFF && !zone.approachLocationName) {
      return false;
    }
    return zone.members.every((member) =>
      kernelPointNames.has(this.getPointNameFromLocation(member.locationName)),
    );
  }

  private async loadKernelModelContext(): Promise<KernelModelContext> {
    return this.buildKernelModelContext(await this.kernelApi.getPlantModel());
  }

  private buildKernelModelContext(rawModel: unknown): KernelModelContext {
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

  /**
   * Rejects a dropoff zone whose layout would strand a vehicle: every member
   * slot must be forward-reachable from the zone's feeder (approach) points on
   * the kernel path graph. Reachable-but-long-detour only warns. Relies on
   * loadKernelModelContext to throw ServiceUnavailableException if the kernel is
   * down — a missing model must not be read as "unreachable".
   */
  private async assertDropoffZoneReachable(
    memberLocationNames: string[],
  ): Promise<void> {
    const context = await this.loadKernelModelContext();
    const paths = (context.model.paths as PlantPath[] | undefined) ?? [];
    const pointToLocation = new Map(
      memberLocationNames.map((name) => [
        this.getPointNameFromLocation(name),
        name,
      ]),
    );
    const memberPointNames = new Set(pointToLocation.keys());

    const { feeders, unreachable, maxHops } = checkZoneReachability(
      paths,
      memberPointNames,
    );

    if (feeders.length === 0) {
      this.logger.warn(
        `Zone reachability: no feeder (external inbound) path for members [${memberLocationNames.join(', ')}] — cannot verify; approach will link all members`,
      );
      return;
    }

    if (unreachable.length > 0) {
      const names = unreachable.map((pt) => pointToLocation.get(pt) ?? pt);
      throw new BadRequestException(
        `Layout khu trả hàng không hợp lệ: các vị trí ${names.join(', ')} không thể tới được từ điểm vào của khu — sẽ khiến AGV đi vòng hoặc kẹt. Hãy điều chỉnh danh sách vị trí hoặc bản đồ.`,
      );
    }

    if (maxHops > memberPointNames.size) {
      this.logger.warn(
        `Zone reachability: layout reachable but with a long detour (maxHops=${maxHops}, members=${memberPointNames.size})`,
      );
    }
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

  /**
   * Reconciles WES zones with the kernel's current map.
   *
   * Rules:
   * - A member location may belong to at most one ACTIVE zone.
   * - Sync never resurrects a STALE zone: only currently-ACTIVE zones are
   *   candidates to stay ACTIVE.
   * - A candidate whose member points are gone → STALE (unrepairable).
   * - If two or more candidates share a member location, all of them → STALE
   *   (an unresolved conflict to be sorted out manually).
   * - Surviving winners keep ACTIVE and have their missing locations rebuilt in a
   *   single PUT. If the kernel rejects the write (e.g. read-only/OPERATING), the
   *   zones that needed rebuilding fall back to STALE.
   */
  async sync(): Promise<SyncResult> {
    // Sync may rewrite the kernel map, so always read it fresh (not from cache).
    this.kernelApi.invalidatePlantModelCache();
    const rawModel = await this.kernelApi.getPlantModel();
    const runtime = this.buildRuntimePlantModel(rawModel);

    if (!runtime) {
      this.logger.warn('Sync skipped: kernel unreachable');
      return {
        total: 0,
        markedStale: 0,
        markedActive: 0,
        kernelUnreachable: true,
      };
    }

    const context = this.buildKernelModelContext(rawModel);
    const zones = await this.zoneRepo.find({ relations: { members: true } });

    // Candidates: currently ACTIVE and still repairable (member points exist).
    const candidates = zones.filter(
      (zone) =>
        zone.status === ZoneStatus.ACTIVE &&
        this.canRepairZone(zone, runtime.pointNames),
    );

    // Any member location claimed by two+ candidates disqualifies every zone
    // touching it (both-active conflict → STALE).
    const claimants = new Map<string, ZoneEntity[]>();
    for (const zone of candidates) {
      for (const locationName of this.zoneMemberLocationNames(zone)) {
        const list = claimants.get(locationName) ?? [];
        list.push(zone);
        claimants.set(locationName, list);
      }
    }
    const conflictedZoneIds = new Set<string>();
    for (const list of claimants.values()) {
      if (list.length > 1) {
        for (const zone of list) conflictedZoneIds.add(zone.id);
      }
    }

    const winners = candidates.filter(
      (zone) => !conflictedZoneIds.has(zone.id),
    );

    // Everything starts STALE; winners are promoted back to ACTIVE below.
    const desiredStatus = new Map<string, ZoneStatus>(
      zones.map((zone) => [zone.id, ZoneStatus.STALE]),
    );
    const toRebuild: ZoneEntity[] = [];
    for (const zone of winners) {
      desiredStatus.set(zone.id, ZoneStatus.ACTIVE);
      if (!this.isZoneValid(zone, runtime)) {
        // Locations missing but repairable → queue a rebuild.
        this.appendZoneLocations(context, zone);
        toRebuild.push(zone);
      }
    }

    if (toRebuild.length > 0) {
      try {
        await savePlantModel(this.kernelApi, {
          ...context.model,
          locations: context.updatedLocations,
        });
      } catch (err) {
        // Kernel refused the write (read-only / OPERATING) — can't restore now.
        // Winners that were already valid keep ACTIVE; only those needing a
        // rebuild fall back to STALE.
        for (const zone of toRebuild) {
          desiredStatus.set(zone.id, ZoneStatus.STALE);
        }
        this.logger.warn(
          `Không thể ghi location khôi phục (kernel cần chế độ Thiết kế?): ${
            (err as Error).message
          }`,
        );
      }
    }

    let markedStale = 0;
    let markedActive = 0;
    for (const zone of zones) {
      const targetStatus = desiredStatus.get(zone.id) ?? ZoneStatus.STALE;
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

  private zoneMemberLocationNames(zone: ZoneEntity): string[] {
    return [...new Set(zone.members.map((member) => member.locationName))];
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

  private buildRuntimePlantModel(rawModel: unknown): RuntimePlantModel | null {
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

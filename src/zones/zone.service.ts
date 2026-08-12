import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ZoneEntity, ZoneStatus, ZoneType } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import {
  readPlantTopology,
  removeLocations,
  upsertMemberLocations,
  type KernelLocationType,
  type MemberLocationSpec,
  type PlantTopology,
} from '../opentcs/plant-model-locations';
import type { CreateZoneDto, UpdateZoneDto } from './zone.dto';
import { checkZoneReachability } from './domain/zone-topology';

export const LOCATION_PREFIX = 'location_';

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
  plantModelName: string | null;
  total: number;
  markedStale: number;
  markedActive: number;
  skippedOtherMaps: number;
  unassigned: number;
  kernelUnreachable: boolean;
}

export interface AssignMapResult {
  plantModelName: string;
  assigned: number;
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

    const topology = await readPlantTopology(this.kernelApi);
    if (!topology) {
      throw new ServiceUnavailableException(
        'Không thể đọc bản đồ đang tải trên kernel — chưa xác định được khu vực thuộc bản đồ nào.',
      );
    }

    if (dto.type === ZoneType.DROPOFF) {
      this.assertDropoffZoneReachable(
        topology,
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
        plantModelName: topology.name,
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

      await this.applyZoneLocationsToKernel(
        memberLocationNames,
        this.kernelLocationType(dto.type),
      );

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

  private kernelLocationType(zoneType: ZoneType): KernelLocationType {
    return zoneType === ZoneType.DROPOFF ? 'Drop off' : 'Pick up';
  }

  private toMemberSpecs(
    memberLocationNames: string[],
    type: KernelLocationType,
  ): MemberLocationSpec[] {
    return memberLocationNames.map((locationName) => ({
      locationName,
      pointName: this.getPointNameFromLocation(locationName),
      type,
    }));
  }

  private async applyZoneLocationsToKernel(
    memberLocationNames: string[],
    type: KernelLocationType,
  ): Promise<void> {
    await upsertMemberLocations(
      this.kernelApi,
      this.toMemberSpecs(memberLocationNames, type),
    );
    this.logger.log(
      `Zone (${type}): đã tạo ${memberLocationNames.length} location con trong kernel`,
    );
  }

  private canRepairZone(
    zone: ZoneEntity,
    pointNames: ReadonlySet<string>,
  ): boolean {
    if (zone.members.length === 0) return false;
    return zone.members.every((member) =>
      pointNames.has(this.getPointNameFromLocation(member.locationName)),
    );
  }

  private getPointNameFromLocation(locationName: string): string {
    return locationName.startsWith(LOCATION_PREFIX)
      ? locationName.slice(LOCATION_PREFIX.length)
      : locationName;
  }

  private assertDropoffZoneReachable(
    topology: PlantTopology,
    memberLocationNames: string[],
  ): void {
    const pointToLocation = new Map(
      memberLocationNames.map((name) => [
        this.getPointNameFromLocation(name),
        name,
      ]),
    );
    const memberPointNames = new Set(pointToLocation.keys());

    const { feeders, unreachable, maxHops } = checkZoneReachability(
      topology.paths,
      memberPointNames,
    );

    if (feeders.length === 0) {
      this.logger.warn(
        `Zone reachability: no feeder (entry head) for members [${memberLocationNames.join(', ')}] — cannot verify; approach will link all members`,
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

  async list(
    options: { allMaps?: boolean } = {},
  ): Promise<
    Array<ZoneEntity & { occupiedSlotCount: number; totalSlotCount: number }>
  > {
    const allZones = await this.zoneRepo.find({
      relations: { members: true },
      order: { createdAt: 'DESC' },
    });

    const zones = options.allMaps
      ? allZones
      : await this.onlyZonesOfLoadedMap(allZones);

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

    if (await this.belongsToLoadedMap(zone)) {
      await this.removeZoneLocationsFromKernel(zone);
    }
    await this.zoneRepo.softDelete(id);
  }

  private async belongsToLoadedMap(zone: ZoneEntity): Promise<boolean> {
    const loadedMapName = await this.kernelApi.getPlantModelName();
    return loadedMapName !== null && zone.plantModelName === loadedMapName;
  }

  private async onlyZonesOfLoadedMap(
    zones: ZoneEntity[],
  ): Promise<ZoneEntity[]> {
    if (zones.length === 0) return [];
    const loadedMapName = await this.kernelApi.getPlantModelName();
    if (loadedMapName === null) return [];
    return zones.filter((zone) => zone.plantModelName === loadedMapName);
  }

  /**
   * Stamps zones with the loaded plant model. This is deliberately an explicit
   * operator action: maps routinely share point names, so a zone whose points
   * all exist in the loaded map is NOT evidence that it was drawn there.
   */
  async assignToLoadedMap(zoneIds: string[]): Promise<AssignMapResult> {
    const topology = await readPlantTopology(this.kernelApi);
    if (!topology) {
      throw new ServiceUnavailableException(
        'Không thể đọc bản đồ đang tải trên kernel.',
      );
    }

    const zones = await this.zoneRepo.find({
      where: { id: In(zoneIds) },
      relations: { members: true },
    });
    if (zones.length === 0) {
      throw new NotFoundException('Không tìm thấy khu vực nào để gán.');
    }

    const offMap = zones.filter(
      (zone) => !this.canRepairZone(zone, topology.pointNames),
    );
    if (offMap.length > 0) {
      const names = offMap.map((zone) => `"${zone.name}"`).join(', ');
      throw new BadRequestException(
        `Không thể gán ${names} vào bản đồ "${topology.name}": khu vực có vị trí không tồn tại trên bản đồ này.`,
      );
    }

    for (const zone of zones) {
      zone.plantModelName = topology.name;
      await this.zoneRepo.save(zone);
      this.logger.log(
        `Zone "${zone.name}" (${zone.id}) assigned to map "${topology.name}"`,
      );
    }

    return { plantModelName: topology.name, assigned: zones.length };
  }

  /**
   * Reconciles WES zones with the kernel's current map.
   *
   * Rules:
   * - Only zones belonging to the loaded plant model are reconciled. Zones drawn
   *   on another map — and zones not assigned to any map yet — are left
   *   untouched, so switching maps never invalidates them (STALE is one-way, see
   *   below) and no zone is ever silently claimed by the wrong map.
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
    const topology = await readPlantTopology(this.kernelApi);

    if (!topology) {
      this.logger.warn('Sync skipped: kernel unreachable');
      return {
        plantModelName: null,
        total: 0,
        markedStale: 0,
        markedActive: 0,
        skippedOtherMaps: 0,
        unassigned: 0,
        kernelUnreachable: true,
      };
    }

    const allZones = await this.zoneRepo.find({ relations: { members: true } });
    const zones = allZones.filter(
      (zone) => zone.plantModelName === topology.name,
    );
    const unassigned = allZones.filter((zone) => !zone.plantModelName).length;
    const skippedOtherMaps = allZones.length - zones.length - unassigned;

    const candidates = zones.filter(
      (zone) =>
        zone.status === ZoneStatus.ACTIVE &&
        this.canRepairZone(zone, topology.pointNames),
    );

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

    const desiredStatus = new Map<string, ZoneStatus>(
      zones.map((zone) => [zone.id, ZoneStatus.STALE]),
    );
    const toRebuild: ZoneEntity[] = [];
    const rebuildSpecs: MemberLocationSpec[] = [];
    for (const zone of winners) {
      desiredStatus.set(zone.id, ZoneStatus.ACTIVE);
      if (!this.isZoneValid(zone, topology)) {
        rebuildSpecs.push(
          ...this.toMemberSpecs(
            this.zoneMemberLocationNames(zone),
            this.kernelLocationType(zone.type),
          ),
        );
        toRebuild.push(zone);
      }
    }

    if (toRebuild.length > 0) {
      try {
        await upsertMemberLocations(this.kernelApi, rebuildSpecs);
      } catch (err) {
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
      plantModelName: topology.name,
      total: zones.length,
      markedStale,
      markedActive,
      skippedOtherMaps,
      unassigned,
      kernelUnreachable: false,
    };
  }

  private zoneMemberLocationNames(zone: ZoneEntity): string[] {
    return [...new Set(zone.members.map((member) => member.locationName))];
  }

  private isZoneValid(zone: ZoneEntity, topology: PlantTopology): boolean {
    for (const member of zone.members) {
      const memberLinks = topology.locationLinks.get(member.locationName);
      if (!memberLinks) {
        return false;
      }

      const pointName = this.getPointNameFromLocation(member.locationName);
      if (!topology.pointNames.has(pointName) || !memberLinks.has(pointName)) {
        return false;
      }
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

  private async removeZoneLocationsFromKernel(zone: ZoneEntity): Promise<void> {
    const memberLocationNames = this.zoneMemberLocationNames(zone);
    if (memberLocationNames.length === 0) return;

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

    const removableNames = memberLocationNames.filter(
      (locationName) => !sharedLocationNames.has(locationName),
    );
    if (removableNames.length === 0) return;

    await removeLocations(this.kernelApi, removableNames);
    this.logger.log(`Zone "${zone.name}" (${zone.id}) soft-deleted`);
  }
}

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
  type PlantTopology,
} from '../opentcs/plant-model-locations';
import { ZoneLocationWriter } from './zone-location.writer';
import { ZoneUsageQuery } from './zone-usage.query';
import {
  toZoneResponse,
  type CreateZoneDto,
  type UpdateZoneDto,
  type ZoneListItemResponse,
  type ZoneResponse,
} from './zone.dto';
import {
  reviewDropoffLayout,
  type LayoutProblem,
} from './domain/zone-layout.rules';
import { pointNameOf } from './domain/location-naming';
import {
  planZoneSync,
  withRebuildsFailed,
  type SyncCandidate,
  type SyncStatus,
} from './domain/zone-sync.policy';
import { ZONE_COLOR_PALETTE, pickLeastUsedColor } from './domain/zone-color';

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
    private readonly locationWriter: ZoneLocationWriter,
    private readonly usage: ZoneUsageQuery,
  ) {}

  async create(dto: CreateZoneDto): Promise<ZoneResponse> {
    this.validateMembers(dto);

    const topology = await readPlantTopology(this.kernelApi);
    if (!topology) {
      throw new ServiceUnavailableException(
        'Không thể đọc bản đồ đang tải trên hệ thống điều khiển — chưa xác định được khu vực thuộc bản đồ nào.',
      );
    }

    if (dto.type === ZoneType.DROPOFF) {
      this.assertDropoffZoneReachable(
        topology,
        dto.members.map((member) => member.locationName),
      );
    }

    const color = dto.color ?? (await this.pickDefaultColor());
    const memberLocationNames = dto.members.map(
      (member) => member.locationName,
    );

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
      const members = dto.members.map((member) =>
        memberRepo.create({
          zoneId: saved.id,
          locationName: member.locationName,
          positionIndex: member.positionIndex,
        }),
      );
      await memberRepo.save(members);

      return saved.id;
    });

    await this.projectNewZoneToKernel(savedZoneId, dto, memberLocationNames);

    const saved = await this.zoneRepo.findOneOrFail({
      where: { id: savedZoneId },
      relations: { members: true },
    });
    return toZoneResponse(saved);
  }

  async update(id: string, dto: UpdateZoneDto): Promise<ZoneResponse> {
    const zone = await this.zoneRepo.findOne({
      where: { id },
      relations: { members: true },
    });
    if (!zone) {
      throw new NotFoundException('Khu vực không tồn tại.');
    }
    zone.color = dto.color;
    return toZoneResponse(await this.zoneRepo.save(zone));
  }

  private async projectNewZoneToKernel(
    zoneId: string,
    dto: CreateZoneDto,
    memberLocationNames: string[],
  ): Promise<void> {
    try {
      await this.locationWriter.write(
        this.locationWriter.specsFor(
          memberLocationNames,
          this.locationWriter.kernelTypeOf(dto.type),
        ),
      );
    } catch (err) {
      await this.zoneRepo.update(zoneId, { status: ZoneStatus.STALE });
      this.logger.warn(
        `Zone "${dto.name}" (${zoneId}) saved, but its locations could not be written to the kernel — marked STALE, run sync to repair: ${(err as Error).message}`,
      );
    }
  }

  private async pickDefaultColor(): Promise<string> {
    const zones = await this.zoneRepo.find({
      where: { status: ZoneStatus.ACTIVE },
      select: { id: true, color: true },
    });
    return pickLeastUsedColor(
      ZONE_COLOR_PALETTE,
      zones
        .map((zone) => zone.color)
        .filter((color): color is string => Boolean(color)),
    );
  }

  private canRepairZone(
    zone: ZoneEntity,
    pointNames: ReadonlySet<string>,
  ): boolean {
    if (zone.members.length === 0) return false;
    return zone.members.every((member) =>
      pointNames.has(pointNameOf(member.locationName)),
    );
  }

  private assertDropoffZoneReachable(
    topology: PlantTopology,
    memberLocationNames: string[],
  ): void {
    const review = reviewDropoffLayout(
      topology.points,
      topology.paths,
      memberLocationNames,
    );

    if (review.noFeeder) {
      this.logger.warn(
        `Zone reachability: no feeder (entry head) for members [${memberLocationNames.join(', ')}] — cannot verify; approach will link all members`,
      );
      return;
    }

    if (review.longDetour) {
      this.logger.warn(
        `Zone reachability: layout reachable but with a long detour (maxHops=${review.longDetour.maxHops}, members=${review.longDetour.members})`,
      );
    }

    for (const problem of review.problems) {
      throw new BadRequestException(this.layoutProblemMessage(problem));
    }
  }

  private layoutProblemMessage(problem: LayoutProblem): string {
    if (problem.kind === 'unreachable') {
      return `Layout khu trả hàng không hợp lệ: các vị trí ${problem.locationNames.join(', ')} không thể tới được từ điểm vào của khu — sẽ khiến AGV đi vòng hoặc kẹt. Hãy điều chỉnh danh sách vị trí hoặc bản đồ.`;
    }
    return `Layout khu trả hàng không hợp lệ: ${problem.violations
      .map((violation) => `${violation.code} — ${violation.detail}`)
      .join('; ')}. Hãy điều chỉnh danh sách vị trí hoặc bản đồ.`;
  }

  async list(
    options: { allMaps?: boolean } = {},
  ): Promise<ZoneListItemResponse[]> {
    const allZones = await this.zoneRepo.find({
      relations: { members: true },
      order: { createdAt: 'DESC' },
    });

    const zones = options.allMaps
      ? allZones
      : await this.onlyZonesOfLoadedMap(allZones);

    if (zones.length === 0) return [];

    const occupiedByZone = await this.usage.occupiedByZone(
      zones.map((zone) => zone.id),
    );

    return zones.map((z) => ({
      ...toZoneResponse(z),
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
      await this.locationWriter.removeUnshared(zone);
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
        'Không thể đọc bản đồ đang tải trên hệ thống điều khiển.',
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

    const plan = this.planFor(zones, topology);
    const desiredStatus = await this.applyRebuilds(plan, zones, topology);

    let markedStale = 0;
    let markedActive = 0;
    for (const zone of zones) {
      const targetStatus = toZoneStatus(desiredStatus.get(zone.id) ?? 'STALE');
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

  private planFor(zones: ZoneEntity[], topology: PlantTopology) {
    const candidates: SyncCandidate[] = zones.map((zone) => ({
      id: zone.id,
      status: zone.status === ZoneStatus.ACTIVE ? 'ACTIVE' : 'STALE',
      memberLocationNames: this.zoneMemberLocationNames(zone),
    }));
    return planZoneSync(candidates, {
      pointNames: topology.pointNames,
      locationLinks: topology.locationLinks,
    });
  }

  private async applyRebuilds(
    plan: ReturnType<typeof planZoneSync>,
    zones: ZoneEntity[],
    topology: PlantTopology,
  ): Promise<ReadonlyMap<string, SyncStatus>> {
    const toRebuild = zones.filter((zone) => plan.rebuildIds.has(zone.id));
    if (toRebuild.length === 0) return plan.desiredStatus;

    const specs = toRebuild.flatMap((zone) =>
      this.locationWriter.specsFor(
        this.zoneMemberLocationNames(zone),
        this.locationWriter.kernelTypeOf(zone.type),
      ),
    );
    try {
      await this.locationWriter.write(specs);
      return plan.desiredStatus;
    } catch (err) {
      this.logger.warn(
        `Không thể ghi location khôi phục cho bản đồ "${topology.name}" (kernel cần chế độ Thiết kế?): ${(err as Error).message}`,
      );
      return withRebuildsFailed(plan).desiredStatus;
    }
  }

  private zoneMemberLocationNames(zone: ZoneEntity): string[] {
    return [...new Set(zone.members.map((member) => member.locationName))];
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

function toZoneStatus(status: SyncStatus): ZoneStatus {
  return status === 'ACTIVE' ? ZoneStatus.ACTIVE : ZoneStatus.STALE;
}

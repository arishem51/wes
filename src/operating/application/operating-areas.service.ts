import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';
import { OnEvent } from '@nestjs/event-emitter';
import { ZoneService } from '../../zones/zone.service';
import { ZoneStatus, ZoneType } from '../../zones/entities/zone.entity';
import {
  LOCATION_PREFIX,
  pointNameOf,
} from '../../zones/domain/location-naming';
import type { ZoneListItemResponse } from '../../zones/zone.dto';
import { CargoEntity, CargoStatus } from '../../cargo/entities/cargo.entity';
import {
  TransportTaskEntity,
  TaskStatus,
} from '../../cargo/entities/transport-task.entity';
import { TRANSPORT_TASK_EVENTS } from '../../cargo/domain/events';
import { KernelApiService } from '../../opentcs/kernel-api.service';
import type {
  AreaDto,
  AreaKind,
  AreaMemberState,
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from '../dto/operating.dto';

const PICKUP_NOT_YET_LOADED_STATUSES = [
  TaskStatus.CREATED,
  TaskStatus.READY_TO_ASSIGN,
  TaskStatus.BLOCKED,
  TaskStatus.PICKING_UP,
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

interface SlotState {
  state: AreaMemberState;
  cargoId: string;
}

/**
 * Presents wes Zones to the operating client as "Areas" (the shape the retired wes-new backend
 * used). All zone/store logic — kernel Location writes, reachability, sync, kernelId — stays in
 * ZoneService; this only translates field names and derives per-slot occupancy from cargo.
 *
 * Editing (`replaceMembers`) and deleting are refused with 409 while the area still has cargo in
 * flight — wes has no in-place member edit, so an edit is delete + recreate (report §5.9 / §7.2).
 */
@Injectable()
export class OperatingAreasService {
  private readonly ticks = new Subject<void>();

  constructor(
    private readonly zones: ZoneService,
    private readonly kernelApi: KernelApiService,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
  ) {}

  /** Bare SSE tick whenever an area / its kernel Locations change — so every other open
   *  client refetches instead of showing a stale zone list until an F5 or a tab refocus. */
  get changes$(): Observable<void> {
    return this.ticks.asObservable();
  }

  @OnEvent(TRANSPORT_TASK_EVENTS.CREATED)
  @OnEvent(TRANSPORT_TASK_EVENTS.STATUS_CHANGED)
  @OnEvent(TRANSPORT_TASK_EVENTS.COMPLETED)
  @OnEvent(TRANSPORT_TASK_EVENTS.FAILED)
  @OnEvent(TRANSPORT_TASK_EVENTS.UPDATED)
  onCargoChanged(): void {
    this.ticks.next();
  }

  /** `mapIds`: the caller's AUTH-3 map scope (`undefined` = unrestricted — see `ability.ts`). */
  async list(mapIds?: string[]): Promise<AreaDto[]> {
    if (!(await this.mapInScope(mapIds))) return [];
    const zones = await this.zones.list({ allMaps: false, mapIds });
    if (zones.length === 0) return [];
    const slotState = await this.slotStateByLocation(
      zones.flatMap((zone) =>
        zone.members.map((member) => member.locationName),
      ),
    );
    return zones.map((zone) => this.toArea(zone, slotState));
  }

  async create(body: CreateAreaBody, mapIds?: string[]): Promise<AreaDto> {
    await this.assertMapInScope(mapIds);
    const zone = await this.zones.create(
      {
        name: body.name,
        type: body.kind === 'STORE' ? ZoneType.DROPOFF : ZoneType.PICKUP,
        color: HEX6.test(body.color ?? '') ? body.color : undefined,
        operation: body.operation?.trim() || undefined,
        maxVehicles: body.maxVehicles ?? undefined,
        members: this.toZoneMembers(body.members),
      },
      mapIds,
    );
    const area = await this.oneArea(zone.id, mapIds);
    this.ticks.next();
    return area;
  }

  async update(
    id: string,
    body: UpdateAreaBody,
    mapIds?: string[],
  ): Promise<AreaDto> {
    await this.assertMapInScope(mapIds);
    await this.oneArea(id, mapIds);
    const trimmedName = body.name?.trim();
    const trimmedOperation = body.operation?.trim();
    const hasUpdate =
      (body.color && HEX6.test(body.color)) ||
      trimmedName ||
      trimmedOperation ||
      body.maxVehicles !== undefined;
    if (hasUpdate) {
      await this.zones.update(
        id,
        {
          ...(body.color && HEX6.test(body.color) ? { color: body.color } : {}),
          ...(trimmedName ? { name: trimmedName } : {}),
          ...(trimmedOperation ? { operation: trimmedOperation } : {}),
          ...(body.maxVehicles !== undefined
            ? { maxVehicles: body.maxVehicles }
            : {}),
        },
        mapIds,
      );
    }
    const area = await this.oneArea(id, mapIds);
    this.ticks.next();
    return area;
  }

  async replaceMembers(
    id: string,
    body: ReplaceAreaMembersBody,
    mapIds?: string[],
  ): Promise<AreaDto> {
    await this.assertMapInScope(mapIds);
    const existing = await this.oneArea(id, mapIds);
    await this.assertNoActiveCargo(id, 'sửa');

    await this.zones.remove(id, mapIds);
    const zone = await this.zones.create(
      {
        name: body.name?.trim() || existing.name,
        type: existing.kind === 'STORE' ? ZoneType.DROPOFF : ZoneType.PICKUP,
        color:
          existing.color && HEX6.test(existing.color)
            ? existing.color
            : undefined,
        members: this.toZoneMembers(body.members),
      },
      mapIds,
    );
    const area = await this.oneArea(zone.id, mapIds);
    this.ticks.next();
    return area;
  }

  async remove(id: string, mapIds?: string[]): Promise<void> {
    await this.assertMapInScope(mapIds);
    await this.oneArea(id, mapIds);
    await this.assertNoActiveCargo(id, 'xoá');
    await this.zones.remove(id, mapIds);
    this.ticks.next();
  }

  /**
   * Reconcile every Zone/Store of the loaded map with the kernel: rebuild missing member
   * Locations and PUT the updated plant model. Delegates to ZoneService.sync().
   */
  async sync(mapIds?: string[]) {
    await this.assertMapInScope(mapIds);
    const result = await this.zones.sync(mapIds);
    this.ticks.next();
    return result;
  }

  /** True unless the caller is scoped and the currently-loaded map falls outside that scope. */
  private async mapInScope(mapIds: string[] | undefined): Promise<boolean> {
    if (mapIds === undefined) return true;
    const activeId = await this.zones.activeMapRecordId();
    return activeId !== null && mapIds.includes(activeId);
  }

  private async assertMapInScope(mapIds: string[] | undefined): Promise<void> {
    if (!(await this.mapInScope(mapIds))) {
      throw new ForbiddenException(
        'Vai trò của bạn không được gán quyền thao tác trên bản đồ đang tải.',
      );
    }
  }

  private toZoneMembers(
    members: { pointName: string; priority?: number }[],
  ): { locationName: string; positionIndex: number }[] {
    return members
      .map((member, index) => ({
        pointName: member.pointName,
        priority: member.priority ?? index,
      }))
      .sort((a, b) => a.priority - b.priority)
      .map((member, index) => ({
        locationName: `${LOCATION_PREFIX}${member.pointName}`,
        positionIndex: index,
      }));
  }

  private async oneArea(id: string, mapIds?: string[]): Promise<AreaDto> {
    const area = (await this.list(mapIds)).find(
      (candidate) => candidate.wesId === id,
    );
    if (!area)
      throw new NotFoundException(
        'Khu vực không tồn tại hoặc không thuộc bản đồ đang tải.',
      );
    return area;
  }

  private async assertNoActiveCargo(
    zoneId: string,
    verb: string,
  ): Promise<void> {
    const inFlight = await this.cargoRepo.count({
      where: [
        {
          sourceZoneId: zoneId,
          status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]),
        },
        {
          destinationZoneId: zoneId,
          status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]),
        },
      ],
    });
    if (inFlight > 0) {
      throw new ConflictException(
        `Còn hàng đang xử lý trong khu vực này — không thể ${verb} location. Hãy chờ hoàn tất hoặc huỷ hàng.`,
      );
    }
  }

  private async slotStateByLocation(
    locationNames: string[],
  ): Promise<Map<string, SlotState>> {
    const out = new Map<string, SlotState>();
    const locations = [...new Set(locationNames)];
    if (locations.length === 0) return out;

    const cargos = await this.cargoRepo.find({
      where: [
        {
          destinationLocationName: In(locations),
          status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]),
        },
        { reservedLocationName: In(locations), status: CargoStatus.ACTIVE },
        { sourcePickupLocationName: In(locations), status: CargoStatus.ACTIVE },
      ],
    });

    for (const cargo of cargos) {
      const committed = cargo.destinationLocationName;
      if (committed && locations.includes(committed)) {
        out.set(committed, { state: 'OCCUPIED', cargoId: cargo.id });
      }
    }

    const pickupCandidates = cargos.filter(
      (cargo) =>
        cargo.sourcePickupLocationName &&
        locations.includes(cargo.sourcePickupLocationName) &&
        !out.has(cargo.sourcePickupLocationName),
    );
    if (pickupCandidates.length > 0) {
      const tasks = await this.taskRepo.find({
        where: { cargoId: In(pickupCandidates.map((cargo) => cargo.id)) },
        order: { createdAt: 'DESC' },
      });
      const latestStatusByCargoId = new Map<string, TaskStatus>();
      for (const task of tasks) {
        if (task.cargoId && !latestStatusByCargoId.has(task.cargoId)) {
          latestStatusByCargoId.set(task.cargoId, task.status);
        }
      }
      for (const cargo of pickupCandidates) {
        const status = latestStatusByCargoId.get(cargo.id);
        const stillAtSource =
          status !== undefined &&
          PICKUP_NOT_YET_LOADED_STATUSES.includes(status);
        if (stillAtSource) {
          out.set(cargo.sourcePickupLocationName as string, {
            state: 'OCCUPIED',
            cargoId: cargo.id,
          });
        }
      }
    }

    for (const cargo of cargos) {
      const reserved = cargo.reservedLocationName;
      if (reserved && locations.includes(reserved) && !out.has(reserved)) {
        out.set(reserved, { state: 'RESERVED', cargoId: cargo.id });
      }
    }
    return out;
  }

  private toArea(
    zone: ZoneListItemResponse,
    slotState: Map<string, SlotState>,
  ): AreaDto {
    const kind: AreaKind = zone.type === ZoneType.DROPOFF ? 'STORE' : 'ZONE';
    return {
      wesId: zone.id,
      name: zone.name,
      kind,
      operation:
        zone.operation ??
        (kind === 'STORE'
          ? this.kernelApi.unloadOperation
          : this.kernelApi.loadOperation),
      maxVehicles: zone.maxVehicles,
      color: zone.color,
      plantModelName: zone.plantModelName,
      status: zone.status === ZoneStatus.STALE ? 'STALE' : 'ACTIVE',
      members: zone.members.map((member) => {
        const slot = slotState.get(member.locationName);
        return {
          wesId: member.locationName,
          areaId: zone.id,
          opentcsLocationName: member.locationName,
          opentcsPointName: pointNameOf(member.locationName),
          priority: member.positionIndex,
          state: slot?.state ?? 'FREE',
          cargoId: slot?.cargoId ?? null,
        };
      }),
    };
  }
}

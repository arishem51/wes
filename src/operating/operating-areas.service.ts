import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ZoneService } from '../zones/zone.service';
import { ZoneType } from '../zones/entities/zone.entity';
import { LOCATION_PREFIX, pointNameOf } from '../zones/domain/location-naming';
import type { ZoneListItemResponse } from '../zones/zone.dto';
import { CargoEntity, CargoStatus } from '../cargo/entities/cargo.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type {
  AreaDto,
  AreaKind,
  AreaMemberState,
  CreateAreaBody,
  ReplaceAreaMembersBody,
  UpdateAreaBody,
} from './dto/operating.dto';

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
  constructor(
    private readonly zones: ZoneService,
    private readonly kernelApi: KernelApiService,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
  ) {}

  async list(): Promise<AreaDto[]> {
    const zones = await this.zones.list({ allMaps: false });
    if (zones.length === 0) return [];
    const slotState = await this.slotStateByLocation(
      zones.flatMap((zone) => zone.members.map((member) => member.locationName)),
    );
    return zones.map((zone) => this.toArea(zone, slotState));
  }

  async create(body: CreateAreaBody): Promise<AreaDto> {
    const zone = await this.zones.create({
      name: body.name,
      type: body.kind === 'STORE' ? ZoneType.DROPOFF : ZoneType.PICKUP,
      color: HEX6.test(body.color ?? '') ? body.color : undefined,
      members: this.toZoneMembers(body.members),
    });
    return this.oneArea(zone.id);
  }

  async update(id: string, body: UpdateAreaBody): Promise<AreaDto> {
    if (body.color && HEX6.test(body.color)) {
      await this.zones.update(id, { color: body.color });
    }
    return this.oneArea(id);
  }

  async replaceMembers(id: string, body: ReplaceAreaMembersBody): Promise<AreaDto> {
    const existing = await this.oneArea(id);
    await this.assertNoActiveCargo(id, 'sửa');

    await this.zones.remove(id);
    const zone = await this.zones.create({
      name: body.name?.trim() || existing.name,
      type: existing.kind === 'STORE' ? ZoneType.DROPOFF : ZoneType.PICKUP,
      color: existing.color && HEX6.test(existing.color) ? existing.color : undefined,
      members: this.toZoneMembers(body.members),
    });
    return this.oneArea(zone.id);
  }

  async remove(id: string): Promise<void> {
    await this.assertNoActiveCargo(id, 'xoá');
    await this.zones.remove(id);
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

  private async oneArea(id: string): Promise<AreaDto> {
    const area = (await this.list()).find((candidate) => candidate.wesId === id);
    if (!area) throw new NotFoundException('Khu vực không tồn tại hoặc không thuộc bản đồ đang tải.');
    return area;
  }

  private async assertNoActiveCargo(zoneId: string, verb: string): Promise<void> {
    const inFlight = await this.cargoRepo.count({
      where: [
        { sourceZoneId: zoneId, status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]) },
        { destinationZoneId: zoneId, status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]) },
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
      ],
    });

    for (const cargo of cargos) {
      const committed = cargo.destinationLocationName;
      if (committed && locations.includes(committed)) {
        out.set(committed, { state: 'OCCUPIED', cargoId: cargo.id });
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
        kind === 'STORE' ? this.kernelApi.unloadOperation : this.kernelApi.loadOperation,
      maxVehicles: null,
      color: zone.color,
      plantModelName: zone.plantModelName,
      status: zone.status === 'STALE' ? 'STALE' : 'ACTIVE',
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

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';
import {
  removeLocations,
  upsertMemberLocations,
  type KernelLocationType,
  type MemberLocationSpec,
} from '../opentcs/plant-model-locations';
import { ZoneEntity, ZoneType } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { pointNameOf } from './domain/location-naming';

@Injectable()
export class ZoneLocationWriter {
  private readonly logger = new Logger(ZoneLocationWriter.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    @InjectRepository(ZoneMemberEntity)
    private readonly memberRepo: Repository<ZoneMemberEntity>,
  ) {}

  kernelTypeOf(zoneType: ZoneType): KernelLocationType {
    return zoneType === ZoneType.DROPOFF ? 'Drop off' : 'Pick up';
  }

  specsFor(
    memberLocationNames: readonly string[],
    type: KernelLocationType,
  ): MemberLocationSpec[] {
    return memberLocationNames.map((locationName) => ({
      locationName,
      pointName: pointNameOf(locationName),
      type,
    }));
  }

  async write(specs: readonly MemberLocationSpec[]): Promise<void> {
    if (specs.length === 0) return;
    const priorVehicles = await this.snapshotVehicles();
    await upsertMemberLocations(this.kernelApi, [...specs]);
    this.logger.log(`Wrote ${specs.length} zone location(s) to the kernel`);
    await this.restoreVehicles(priorVehicles);
  }

  async removeUnshared(zone: ZoneEntity): Promise<void> {
    const memberLocationNames = [
      ...new Set(zone.members.map((member) => member.locationName)),
    ];
    if (memberLocationNames.length === 0) return;

    const shared = await this.sharedWithOtherZones(
      zone.id,
      memberLocationNames,
    );
    const removable = memberLocationNames.filter((name) => !shared.has(name));
    if (removable.length === 0) return;

    const priorVehicles = await this.snapshotVehicles();
    await removeLocations(this.kernelApi, removable);
    this.logger.log(
      `Zone "${zone.name}" (${zone.id}): removed ${removable.length} location(s) from the kernel`,
    );
    await this.restoreVehicles(priorVehicles);
  }

  /**
   * A `PUT /v1/plantModel` (how location writes land in openTCS) re-initialises every vehicle:
   * comm adapter disabled, integration level reset to the model default. Left alone, a single
   * zone edit darkens the whole running fleet until someone re-enables each vehicle by hand —
   * this is the "cứ phải F5 / xe đứng im sau khi sửa zone" report. Snapshot the fleet before
   * the write and put each vehicle back exactly as it was afterwards.
   */
  private async snapshotVehicles(): Promise<KernelVehicleState[]> {
    try {
      return await this.kernelApi.getVehicleStates();
    } catch {
      return [];
    }
  }

  private async restoreVehicles(prior: KernelVehicleState[]): Promise<void> {
    for (const v of prior) {
      // `state === 'UNKNOWN'` == the comm adapter was already detached; don't wake it.
      if (v.state === 'UNKNOWN') continue;
      try {
        await this.kernelApi.setVehicleAdapterEnabled(v.name, true);
        await this.kernelApi.setVehicleIntegrationLevel(
          v.name,
          v.integrationLevel,
        );
      } catch (err) {
        this.logger.warn(
          `Could not restore vehicle "${v.name}" after location write: ${(err as Error).message}`,
        );
      }
    }
  }

  private async sharedWithOtherZones(
    zoneId: string,
    memberLocationNames: readonly string[],
  ): Promise<Set<string>> {
    const rows = await this.memberRepo
      .createQueryBuilder('member')
      .select('member.locationName', 'locationName')
      .innerJoin(ZoneEntity, 'zone', 'zone.id = member.zoneId')
      .where('member.zoneId != :zoneId', { zoneId })
      .andWhere('member.locationName IN (:...names)', {
        names: memberLocationNames,
      })
      .andWhere('zone.deletedAt IS NULL')
      .distinct(true)
      .getRawMany<{ locationName: string }>();

    return new Set(rows.map((row) => row.locationName));
  }
}

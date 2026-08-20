import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KernelApiService } from '../opentcs/kernel-api.service';
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
    await upsertMemberLocations(this.kernelApi, [...specs]);
    this.logger.log(`Wrote ${specs.length} zone location(s) to the kernel`);
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

    await removeLocations(this.kernelApi, removable);
    this.logger.log(
      `Zone "${zone.name}" (${zone.id}): removed ${removable.length} location(s) from the kernel`,
    );
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

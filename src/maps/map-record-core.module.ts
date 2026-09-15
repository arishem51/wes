import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapRecordEntity } from './infrastructure/entities/map-record.entity';
import { ActiveMapRecordService } from './infrastructure/active-map-record.service';
import { OpenTcsModule } from '../opentcs/opentcs.module';

/**
 * The minimal slice of the map library both `MapsModule` and `ZoneModule` need —
 * `ActiveMapRecordService` — split out so the two don't have to import each other
 * (`MapsModule` already imports `ZoneModule` to trigger a zone sync after a map load).
 */
@Module({
  imports: [TypeOrmModule.forFeature([MapRecordEntity]), OpenTcsModule],
  providers: [ActiveMapRecordService],
  exports: [ActiveMapRecordService],
})
export class MapRecordCoreModule {}

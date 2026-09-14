import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapRecordEntity } from './entities/map-record.entity';
import { MapsService } from './maps.service';
import { MapsController } from './maps.controller';
import { OpenTcsModule } from '../opentcs/opentcs.module';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { ZoneModule } from '../zones/zone.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MapRecordEntity, CargoEntity, ZoneEntity]),
    OpenTcsModule,
    ZoneModule,
  ],
  providers: [MapsService],
  controllers: [MapsController],
})
export class MapsModule {}

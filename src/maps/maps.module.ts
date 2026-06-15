import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapRecordEntity } from './entities/map-record.entity';
import { MapsService } from './maps.service';
import { MapsController } from './maps.controller';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [TypeOrmModule.forFeature([MapRecordEntity]), OpenTcsModule],
  providers: [MapsService],
  controllers: [MapsController],
})
export class MapsModule {}

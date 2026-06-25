import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZoneEntity } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { ZoneController } from './zone.controller';
import { ZoneService } from './zone.service';
import { KernelApiService } from '../opentcs/kernel-api.service';

@Module({
  imports: [TypeOrmModule.forFeature([ZoneEntity, ZoneMemberEntity])],
  controllers: [ZoneController],
  providers: [ZoneService, KernelApiService],
  exports: [ZoneService],
})
export class ZoneModule {}

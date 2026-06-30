import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZoneEntity } from './entities/zone.entity';
import { ZoneMemberEntity } from './entities/zone-member.entity';
import { ZoneController } from './zone.controller';
import { ZoneService } from './zone.service';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ZoneEntity, ZoneMemberEntity]),
    OpenTcsModule,
  ],
  controllers: [ZoneController],
  providers: [ZoneService],
  exports: [ZoneService],
})
export class ZoneModule {}

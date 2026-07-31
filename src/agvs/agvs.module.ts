import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgvEntity } from './entities/agv.entity';
import { VehicleErrorEventEntity } from './entities/vehicle-error-event.entity';
import { AgvsService } from './agvs.service';
import { VehicleErrorService } from './vehicle-error.service';
import { AgvsController } from './agvs.controller';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgvEntity, VehicleErrorEventEntity]),
    OpenTcsModule,
  ],
  providers: [AgvsService, VehicleErrorService],
  controllers: [AgvsController],
})
export class AgvsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgvEntity } from './entities/agv.entity';
import { VehicleErrorEventEntity } from './entities/vehicle-error-event.entity';
import { VehicleStateTransitionEntity } from '../opentcs/entities/vehicle-state-transition.entity';
import { TransportTaskEntity } from '../cargo/entities/transport-task.entity';
import { AgvsService } from './agvs.service';
import { AgvHistoryService } from './agv-history.service';
import { VehicleErrorService } from './vehicle-error.service';
import { AgvsController } from './agvs.controller';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgvEntity,
      VehicleErrorEventEntity,
      VehicleStateTransitionEntity,
      TransportTaskEntity,
    ]),
    OpenTcsModule,
  ],
  providers: [AgvsService, AgvHistoryService, VehicleErrorService],
  controllers: [AgvsController],
})
export class AgvsModule {}

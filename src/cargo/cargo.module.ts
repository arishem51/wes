import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CargoEntity } from './entities/cargo.entity';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { CargoService } from './cargo.service';
import { CargoController } from './cargo.controller';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';
import { EventProcessorService } from './event-processor.service';
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import { DeliverySlotEngine } from './delivery-slot.engine';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CargoEntity, TransportTaskEntity, ZoneEntity]),
    OpenTcsModule,
  ],
  providers: [
    CargoService,
    DeliverySlotEngine,
    ReleaseEngineService,
    AssignmentEngineService,
    DispatchSchedulerService,
    EventProcessorService,
  ],
  controllers: [CargoController],
  exports: [DeliverySlotEngine],
})
export class CargoModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CargoEntity } from './entities/cargo.entity';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { CargoService } from './cargo.service';
import { CargoController } from './cargo.controller';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';
import { EventProcessorService } from './event-processor.service';
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CargoEntity, TransportTaskEntity]),
    OpenTcsModule,
  ],
  providers: [
    CargoService,
    ReleaseEngineService,
    AssignmentEngineService,
    DispatchSchedulerService,
    EventProcessorService,
  ],
  controllers: [CargoController],
})
export class CargoModule {}

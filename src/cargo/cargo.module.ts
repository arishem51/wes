import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CargoEntity } from './entities/cargo.entity';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { TaskStatusTransitionEntity } from './entities/task-status-transition.entity';
import { DispatchPolicyEntity } from './entities/dispatch-policy.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { CargoService } from './cargo.service';
import { CargoController } from './cargo.controller';
import { DispatchPolicyService } from './dispatch-policy.service';
import { DispatchPolicyController } from './dispatch-policy.controller';
import { TransportTaskService } from './transport-task.service';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';
import { ParkingEngineService } from './parking-engine.service';
import { LegReconcileService } from './leg-reconcile.service';
import { TransportTaskSaga } from './transport-task.saga';
import { DispatchSchedulerService } from './dispatch-scheduler.service';
import { DeliverySlotEngine } from './delivery-slot.engine';
import { ZoneGeometryService } from './zone-geometry.service';
import { PickupDependencyService } from './pickup-dependency.service';
import { RoutingService } from './routing.service';
import { OpenTcsModule } from '../opentcs/opentcs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CargoEntity,
      TransportTaskEntity,
      TaskStatusTransitionEntity,
      DispatchPolicyEntity,
      ZoneEntity,
      AgvEntity,
    ]),
    OpenTcsModule,
  ],
  providers: [
    CargoService,
    TransportTaskService,
    DeliverySlotEngine,
    ZoneGeometryService,
    PickupDependencyService,
    RoutingService,
    DispatchPolicyService,
    ReleaseEngineService,
    AssignmentEngineService,
    ParkingEngineService,
    LegReconcileService,
    DispatchSchedulerService,
    TransportTaskSaga,
  ],
  controllers: [CargoController, DispatchPolicyController],
  exports: [DeliverySlotEngine],
})
export class CargoModule {}

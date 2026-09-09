import { Module } from '@nestjs/common';
import { OpenTcsModule } from '../opentcs/opentcs.module';
import { OperatingPlantModelService } from './operating-plant-model.service';
import { OperatingOrdersService } from './operating-orders.service';
import { OperatingVehiclesService } from './operating-vehicles.service';
import { OperatingPlantModelController } from './plant-model.controller';
import { OperatingVehiclesController } from './vehicles.controller';
import { OperatingOrdersController } from './orders.controller';
import { OperatingHealthController } from './health.controller';

/**
 * ACL passthrough for the operating screen (`wes-new-client-v2`). Read-only kernel projections
 * only — no business logic, no plant-model writes. Consumes `KernelApiService` + the shared
 * `VehicleStateStore` from `OpenTcsModule`; never opens its own kernel SSE connection.
 */
@Module({
  imports: [OpenTcsModule],
  controllers: [
    OperatingPlantModelController,
    OperatingVehiclesController,
    OperatingOrdersController,
    OperatingHealthController,
  ],
  providers: [
    OperatingPlantModelService,
    OperatingOrdersService,
    OperatingVehiclesService,
  ],
})
export class OperatingModule {}

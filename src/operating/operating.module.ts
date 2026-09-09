import { Module } from '@nestjs/common';
import { OpenTcsModule } from '../opentcs/opentcs.module';
import { OperatingPlantModelService } from './operating-plant-model.service';
import { OperatingOrdersService } from './operating-orders.service';
import { OperatingVehiclesService } from './operating-vehicles.service';
import { OperatingCommandsService } from './operating-commands.service';
import { OperatingPlantModelController } from './plant-model.controller';
import { OperatingVehiclesController } from './vehicles.controller';
import { OperatingOrdersController } from './orders.controller';
import { OperatingCommandsController } from './commands.controller';
import { OperatingHealthController } from './health.controller';

/**
 * ACL passthrough for the operating screen (`wes-new-client-v2`). Kernel projections + thin
 * write-side controls (integration level, pause, withdrawal, path lock, manual order, fleet
 * pause/resume) — no cargo/zone business logic, no plant-model writes. Consumes `KernelApiService`
 * + the shared `VehicleStateStore` from `OpenTcsModule`; never opens its own kernel SSE connection.
 */
@Module({
  imports: [OpenTcsModule],
  controllers: [
    OperatingPlantModelController,
    OperatingVehiclesController,
    OperatingOrdersController,
    OperatingCommandsController,
    OperatingHealthController,
  ],
  providers: [
    OperatingPlantModelService,
    OperatingOrdersService,
    OperatingVehiclesService,
    OperatingCommandsService,
  ],
})
export class OperatingModule {}

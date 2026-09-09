import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenTcsModule } from '../opentcs/opentcs.module';
import { CargoModule } from '../cargo/cargo.module';
import { ZoneModule } from '../zones/zone.module';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import { OperatingPlantModelService } from './operating-plant-model.service';
import { OperatingOrdersService } from './operating-orders.service';
import { OperatingVehiclesService } from './operating-vehicles.service';
import { OperatingCommandsService } from './operating-commands.service';
import { OperatingAreasService } from './operating-areas.service';
import { OperatingCargoService } from './operating-cargo.service';
import { OperatingPlantModelController } from './plant-model.controller';
import { OperatingVehiclesController } from './vehicles.controller';
import { OperatingOrdersController } from './orders.controller';
import { OperatingCommandsController } from './commands.controller';
import { OperatingAreasController } from './areas.controller';
import { OperatingCargoController } from './cargo.controller';
import { OperatingHealthController } from './health.controller';

/**
 * Backend surface for the operating screen (`wes-new-client-v2`): kernel projections + thin
 * write-side controls, plus adapters that present wes Zones as "Areas" and wes cargo in the
 * client's flat shape. No cargo/zone business logic lives here — writes go through
 * `ZoneService` / `CargoService`; reads through `KernelApiService` and the shared
 * `VehicleStateStore`. Never opens its own kernel SSE connection.
 */
@Module({
  imports: [
    OpenTcsModule,
    CargoModule,
    ZoneModule,
    TypeOrmModule.forFeature([CargoEntity]),
  ],
  controllers: [
    OperatingPlantModelController,
    OperatingVehiclesController,
    OperatingOrdersController,
    OperatingCommandsController,
    OperatingAreasController,
    OperatingCargoController,
    OperatingHealthController,
  ],
  providers: [
    OperatingPlantModelService,
    OperatingOrdersService,
    OperatingVehiclesService,
    OperatingCommandsService,
    OperatingAreasService,
    OperatingCargoService,
  ],
})
export class OperatingModule {}

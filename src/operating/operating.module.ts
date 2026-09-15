import { Module } from '@nestjs/common';
import { MapRecordCoreModule } from '../maps/map-record-core.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenTcsModule } from '../opentcs/opentcs.module';
import { CargoModule } from '../cargo/cargo.module';
import { ZoneModule } from '../zones/zone.module';
import { UsersModule } from '../users/users.module';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import { TransportTaskEntity } from '../cargo/entities/transport-task.entity';
import { OperatingPlantModelService } from './application/operating-plant-model.service';
import { OperatingOrdersService } from './application/operating-orders.service';
import { OperatingVehiclesService } from './application/operating-vehicles.service';
import { OperatingCommandsService } from './application/operating-commands.service';
import { OperatingAreasService } from './application/operating-areas.service';
import { OperatingCargoService } from './application/operating-cargo.service';
import { OperatingPlantModelController } from './api/plant-model.controller';
import { OperatingVehiclesController } from './api/vehicles.controller';
import { OperatingOrdersController } from './api/orders.controller';
import { OperatingCommandsController } from './api/commands.controller';
import { OperatingAreasController } from './api/areas.controller';
import { OperatingCargoController } from './api/cargo.controller';
import { OperatingHealthController } from './api/health.controller';
import { OperatingStreamController } from './api/stream.controller';

@Module({
  imports: [
    OpenTcsModule,
    MapRecordCoreModule,
    CargoModule,
    ZoneModule,
    UsersModule,
    TypeOrmModule.forFeature([CargoEntity, TransportTaskEntity]),
  ],
  controllers: [
    OperatingPlantModelController,
    OperatingVehiclesController,
    OperatingOrdersController,
    OperatingCommandsController,
    OperatingAreasController,
    OperatingCargoController,
    OperatingHealthController,
    OperatingStreamController,
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

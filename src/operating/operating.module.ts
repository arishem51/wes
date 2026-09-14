import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenTcsModule } from '../opentcs/opentcs.module';
import { CargoModule } from '../cargo/cargo.module';
import { ZoneModule } from '../zones/zone.module';
import { UsersModule } from '../users/users.module';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import { TransportTaskEntity } from '../cargo/entities/transport-task.entity';
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
import { OperatingStreamController } from './stream.controller';

@Module({
  imports: [
    OpenTcsModule,
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

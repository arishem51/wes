import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelApiService } from './kernel-api.service';
import { KernelSyncService } from './kernel-sync.service';
import { KernelEventListenerService } from './kernel-event-listener.service';
import { MapLoaderService } from './map-loader/map-loader.service';
import { VehicleStateStore } from './vehicle-state.store';
import { FleetTelemetryService } from './fleet-telemetry.service';
import { SseSessionEntity } from './entities/sse-session.entity';
import { VehicleStateTransitionEntity } from './entities/vehicle-state-transition.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SseSessionEntity, VehicleStateTransitionEntity]),
  ],
  // Order matters when OPENTCS_MAP_AUTO_LOAD=true: KernelSyncService
  // bootstraps before MapLoaderService attempts to PUT the plant model.
  providers: [
    VehicleStateStore,
    KernelApiService,
    FleetTelemetryService,
    KernelSyncService,
    KernelEventListenerService,
    MapLoaderService,
  ],
  exports: [KernelApiService, VehicleStateStore],
})
export class OpenTcsModule {}

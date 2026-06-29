import { Module } from '@nestjs/common';
import { KernelApiService } from './kernel-api.service';
import { KernelSyncService } from './kernel-sync.service';
import { KernelEventListenerService } from './kernel-event-listener.service';
import { MapLoaderService } from './map-loader/map-loader.service';
import { VehicleStateStore } from './vehicle-state.store';

@Module({
  // Order matters when OPENTCS_MAP_AUTO_LOAD=true: KernelSyncService
  // bootstraps before MapLoaderService attempts to PUT the plant model.
  providers: [
    VehicleStateStore,
    KernelApiService,
    KernelSyncService,
    KernelEventListenerService,
    MapLoaderService,
  ],
  exports: [KernelApiService, VehicleStateStore],
})
export class OpenTcsModule {}

import { Module } from '@nestjs/common';
import { KernelApiService } from './kernel-api.service';
import { KernelSyncService } from './kernel-sync.service';
import { MapLoaderService } from './map-loader/map-loader.service';

@Module({
  // Order matters when OPENTCS_MAP_AUTO_LOAD=true: KernelSyncService
  // bootstraps before MapLoaderService attempts to PUT the plant model.
  providers: [KernelApiService, KernelSyncService, MapLoaderService],
  exports: [KernelApiService],
})
export class OpenTcsModule {}

import { Module } from '@nestjs/common';
import { KernelApiService } from './kernel-api.service';
import { KernelSyncService } from './kernel-sync.service';
import { MapLoaderService } from './map-loader/map-loader.service';

@Module({
  // Order matters: KernelSyncService.onApplicationBootstrap runs before
  // MapLoaderService.onApplicationBootstrap, ensuring kernel is in OPERATING
  // mode before the auto-load attempts to PUT the plant model.
  providers: [KernelApiService, KernelSyncService, MapLoaderService],
  exports: [KernelApiService],
})
export class OpenTcsModule {}

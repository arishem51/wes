import { Module } from '@nestjs/common';
import { KernelApiService } from './kernel-api.service';
import { MapLoaderService } from './map-loader/map-loader.service';

@Module({
  providers: [KernelApiService, MapLoaderService],
  exports: [KernelApiService],
})
export class OpenTcsModule {}

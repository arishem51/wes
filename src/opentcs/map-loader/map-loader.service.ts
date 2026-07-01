import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AxiosError } from 'axios';
import { KernelApiService } from '../kernel-api.service';
import { parseOpenTcsXml, PlantModelDto } from './opentcs-xml.parser';
import { applySingleVehicleBlocks } from '../domain/apply-blocks';

@Injectable()
export class MapLoaderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MapLoaderService.name);

  constructor(private readonly kernelApi: KernelApiService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.OPENTCS_MAP_AUTO_LOAD !== 'true') {
      this.logger.log('Skipping plant model auto-load');
      return;
    }

    const mapPath = resolve(
      process.env.OPENTCS_MAP_PATH ?? '../maps/b300-being-v7.xml',
    );

    await this.loadMap(mapPath);
  }

  async loadMap(mapPath: string): Promise<void> {
    this.logger.log(`Loading plant model from ${mapPath}`);

    let xmlContent: string;
    try {
      xmlContent = readFileSync(mapPath, 'utf-8');
    } catch (err) {
      this.logger.error(
        `Failed to read map file: ${mapPath}`,
        (err as Error).message,
      );
      return;
    }

    let model: PlantModelDto;
    try {
      model = parseOpenTcsXml(xmlContent);
    } catch (err) {
      this.logger.error(
        'Failed to parse plant model XML',
        (err as Error).message,
      );
      return;
    }

    // Serialise single-file / dead-end lanes to prevent multi-AGV deadlock
    // (SINGLE_VEHICLE_ONLY blocks derived from the path graph).
    const blockCount = applySingleVehicleBlocks(model).blocks.length;
    this.logger.log(`Generated ${blockCount} single-vehicle lane block(s)`);

    try {
      await this.kernelApi.putPlantModel(model);
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response) {
        const status = axiosErr.response.status;
        const data = axiosErr.response.data;
        if (status === 409 || status === 400) {
          this.logger.warn(
            `Kernel rejected plant model (status ${status}) — kernel may be in OPERATING mode. Map not loaded.`,
          );
          this.logger.debug(`Kernel response: ${JSON.stringify(data)}`);
        } else {
          this.logger.error(
            `Kernel returned unexpected error (status ${status}) while loading plant model`,
            JSON.stringify(data),
          );
        }
      } else if (axiosErr.request) {
        this.logger.error(
          'Cannot reach kernel — is it running?',
          axiosErr.message,
        );
      } else {
        this.logger.error(
          'Unexpected error loading plant model',
          (err as Error).message,
        );
      }
    }
  }
}

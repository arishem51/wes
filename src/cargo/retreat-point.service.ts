import { Injectable, Logger } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import {
  DROPOFF_RETREAT_CELLS,
  resolveRetreatPath,
} from './domain/retreat-point';

@Injectable()
export class RetreatPointService {
  private readonly logger = new Logger(RetreatPointService.name);

  constructor(private readonly kernelApi: KernelApiService) {}

  async pathFor(
    dropOffLocationName: string,
    cells: number = DROPOFF_RETREAT_CELLS,
  ): Promise<string[] | null> {
    const dropPoint =
      await this.kernelApi.findPointForLocation(dropOffLocationName);
    if (!dropPoint) {
      this.logger.warn(
        `Drop-off "${dropOffLocationName}": no linked point — no retreat point`,
      );
      return null;
    }

    const plantModel = await this.kernelApi.getPlantModelView();
    if (!plantModel) {
      this.logger.warn(
        `Drop-off "${dropOffLocationName}": plant model unavailable — no retreat point`,
      );
      return null;
    }

    const retreatPath = resolveRetreatPath(plantModel, dropPoint, cells);
    if (!retreatPath) {
      this.logger.warn(
        `Drop-off "${dropOffLocationName}" (point ${dropPoint}): no ${cells}-cell retreat behind it`,
      );
      return null;
    }

    this.logger.log(
      `Drop-off "${dropOffLocationName}" (point ${dropPoint}): retreat ${cells} cell(s) → ${retreatPath.join(' → ')}`,
    );
    return retreatPath;
  }
}

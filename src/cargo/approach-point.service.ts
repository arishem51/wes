import { Injectable, Logger } from '@nestjs/common';
import {
  KernelApiService,
  type KernelRoute,
} from '../opentcs/kernel-api.service';
import {
  resolveLocationPoints,
  type PlantLocation,
} from '../zones/domain/member-points';
import {
  computeFeederPoints,
  type PlantPath,
} from '../zones/domain/zone-topology';
import type { ZoneEntity } from '../zones/entities/zone.entity';

@Injectable()
export class ApproachPointService {
  private readonly logger = new Logger(ApproachPointService.name);

  constructor(private readonly kernelApi: KernelApiService) {}

  async pickFor(zone: ZoneEntity, vehicleName: string): Promise<string | null> {
    const candidates = await this.feederPointsOf(zone);
    if (candidates.length === 0) {
      this.logger.warn(`Zone "${zone.name}": no approach point candidates`);
      return null;
    }

    let routes: KernelRoute[];
    try {
      routes = await this.kernelApi.computeRoutes(vehicleName, candidates);
    } catch (err) {
      this.logger.warn(
        `Zone "${zone.name}": route query for ${vehicleName} failed: ${(err as Error).message}`,
      );
      return null;
    }

    const reachable = routes.filter((route) => route.costs >= 0);
    if (reachable.length === 0) {
      this.logger.warn(
        `Zone "${zone.name}": ${vehicleName} cannot reach any approach point [${candidates.join(', ')}]`,
      );
      return null;
    }

    const nearest = reachable.reduce((best, route) =>
      route.costs < best.costs ? route : best,
    );
    this.logger.log(
      `Zone "${zone.name}": ${vehicleName} approaches ${nearest.destinationPoint} (cost ${nearest.costs}, ${candidates.length} candidate(s))`,
    );
    return nearest.destinationPoint;
  }

  private async feederPointsOf(zone: ZoneEntity): Promise<string[]> {
    if (!zone.members || zone.members.length === 0) return [];

    const plantModel = (await this.kernelApi.getPlantModel()) as Record<
      string,
      unknown
    > | null;
    if (!plantModel) {
      this.logger.warn(`Zone "${zone.name}": plant model unavailable`);
      return [];
    }

    const paths = Array.isArray(plantModel.paths)
      ? (plantModel.paths as PlantPath[])
      : [];
    const locations = Array.isArray(plantModel.locations)
      ? (plantModel.locations as PlantLocation[])
      : [];

    const memberPointNames = new Set(
      resolveLocationPoints(
        locations,
        zone.members.map((member) => member.locationName),
      ).values(),
    );

    const feeders = computeFeederPoints(paths, memberPointNames);
    if (feeders.length > 0) return feeders;

    this.logger.warn(
      `Zone "${zone.name}": no feeder head found — falling back to all member points`,
    );
    return [...memberPointNames];
  }
}

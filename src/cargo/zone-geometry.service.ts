import { Injectable, Logger } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { resolveLocationPoints } from '../zones/domain/member-points';
import type { ZoneEntity } from '../zones/entities/zone.entity';

const GRID_ROUND = 1000;

interface PointCoords {
  x: number;
  y: number;
}

export interface MemberAxes {
  depthKey: number;
  laneKey: number;
}

@Injectable()
export class ZoneGeometryService {
  private readonly logger = new Logger(ZoneGeometryService.name);

  constructor(private readonly kernelApi: KernelApiService) {}

  async computeMemberAxes(
    zone: ZoneEntity,
  ): Promise<Map<string, MemberAxes> | null> {
    if (!zone.members || zone.members.length === 0) return null;

    const plantModel = await this.kernelApi.getPlantModelView();
    if (!plantModel) {
      this.logger.warn('computeMemberAxes: plant model unavailable');
      return null;
    }

    const pointMap = new Map<string, PointCoords>(
      plantModel.points.map((point) => [point.name, point.position]),
    );

    const memberPoints = resolveLocationPoints(
      plantModel.locations,
      zone.members.map((member) => member.locationName),
    );
    const memberPointNames = new Set<string>(memberPoints.values());

    const aisleRefCoords: PointCoords[] = [];
    let depthDirX = 0;
    let depthDirY = 0;
    for (const path of plantModel.paths) {
      const dest = path.destPointName;
      const src = path.srcPointName;
      if (!memberPointNames.has(dest) || memberPointNames.has(src)) continue;
      const srcCoords = pointMap.get(src);
      const destCoords = pointMap.get(dest);
      if (!srcCoords || !destCoords) continue;
      aisleRefCoords.push(srcCoords);
      depthDirX += destCoords.x - srcCoords.x;
      depthDirY += destCoords.y - srcCoords.y;
    }

    if (aisleRefCoords.length === 0) {
      this.logger.warn(
        `Zone "${zone.name}": no external inbound paths found — cannot compute axes`,
      );
      return null;
    }

    const aisleCenter: PointCoords = {
      x: aisleRefCoords.reduce((s, p) => s + p.x, 0) / aisleRefCoords.length,
      y: aisleRefCoords.reduce((s, p) => s + p.y, 0) / aisleRefCoords.length,
    };

    const depthLen = Math.hypot(depthDirX, depthDirY) || 1;
    const dx = depthDirX / depthLen;
    const dy = depthDirY / depthLen;
    const lx = -dy;
    const ly = dx;

    const result = new Map<string, MemberAxes>();
    for (const member of zone.members) {
      const pointName = memberPoints.get(member.locationName);
      const coords = pointName ? pointMap.get(pointName) : undefined;
      if (!coords) {
        this.logger.warn(`No point for location "${member.locationName}"`);
        continue;
      }
      const relX = coords.x - aisleCenter.x;
      const relY = coords.y - aisleCenter.y;
      const depth = relX * dx + relY * dy;
      const lane = relX * lx + relY * ly;
      result.set(member.locationName, {
        depthKey: Math.round(depth / GRID_ROUND) * GRID_ROUND,
        laneKey: Math.round(lane / GRID_ROUND) * GRID_ROUND,
      });
    }
    return result;
  }
}

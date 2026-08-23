import { Injectable, Logger } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { resolveLocationPoints } from '../zones/domain/member-points';
import type { KernelPlantModel } from '../opentcs/domain/kernel-model';
import type { ZoneEntity } from '../zones/entities/zone.entity';
import type { ZoneMemberEntity } from '../zones/entities/zone-member.entity';

const GRID_ROUND = 1000;

interface PointCoords {
  x: number;
  y: number;
}

export interface MemberAxes {
  depthKey: number;
  laneKey: number;
}

export interface LaneIndex {
  axesByLocation: Map<string, MemberAxes>;
  pointsByLane: Map<number, Set<string>>;
}

interface CachedLaneIndex {
  memberSignature: string;
  index: LaneIndex;
}

function memberSignature(members: readonly ZoneMemberEntity[]): string {
  return members
    .map((member) => member.locationName)
    .sort()
    .join('|');
}

function pathKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

@Injectable()
export class ZoneGeometryService {
  private readonly logger = new Logger(ZoneGeometryService.name);
  private readonly laneIndexByZone = new Map<string, CachedLaneIndex>();

  constructor(private readonly kernelApi: KernelApiService) {}

  async computeMemberAxes(
    zone: ZoneEntity,
  ): Promise<Map<string, MemberAxes> | null> {
    const plantModel = await this.plantModelFor(zone);
    return plantModel ? this.axesFrom(zone, plantModel) : null;
  }

  async laneIndexOf(zone: ZoneEntity): Promise<LaneIndex | null> {
    const signature = memberSignature(zone.members ?? []);
    const cached = this.laneIndexByZone.get(zone.id);
    if (cached && cached.memberSignature === signature) return cached.index;

    const plantModel = await this.plantModelFor(zone);
    if (!plantModel) return null;

    const axesByLocation = this.axesFrom(zone, plantModel);
    if (!axesByLocation) return null;

    const pointNamesByLocation = await this.kernelApi.getPointNamesByLocation();
    const pointsByLane = new Map<number, Set<string>>();
    for (const [locationName, axes] of axesByLocation) {
      const points = pointsByLane.get(axes.laneKey) ?? new Set<string>();
      for (const point of pointNamesByLocation.get(locationName) ?? []) {
        points.add(point);
      }
      pointsByLane.set(axes.laneKey, points);
    }

    const index: LaneIndex = { axesByLocation, pointsByLane };
    this.laneIndexByZone.set(zone.id, { memberSignature: signature, index });
    this.warnAboutLaneCellsWithoutASlot(
      zone,
      axesByLocation,
      pointNamesByLocation,
      plantModel,
    );
    return index;
  }

  private async plantModelFor(
    zone: ZoneEntity,
  ): Promise<KernelPlantModel | null> {
    if (!zone.members || zone.members.length === 0) return null;

    const plantModel = await this.kernelApi.getPlantModelView();
    if (!plantModel) {
      this.logger.warn(`Zone "${zone.name}": plant model unavailable`);
      return null;
    }
    return plantModel;
  }

  private axesFrom(
    zone: ZoneEntity,
    plantModel: KernelPlantModel,
  ): Map<string, MemberAxes> | null {
    const members = zone.members ?? [];
    const pointMap = new Map<string, PointCoords>(
      plantModel.points.map((point) => [point.name, point.position]),
    );

    const memberPoints = resolveLocationPoints(
      plantModel.locations,
      members.map((member) => member.locationName),
    );
    const memberPointNames = new Set<string>(memberPoints.values());

    const aisleRefCoords: PointCoords[] = [];
    let depthDirX = 0;
    let depthDirY = 0;
    for (const path of plantModel.paths) {
      const srcInside = memberPointNames.has(path.srcPointName);
      const destInside = memberPointNames.has(path.destPointName);
      if (srcInside === destInside) continue;

      const outside = pointMap.get(
        srcInside ? path.destPointName : path.srcPointName,
      );
      const inside = pointMap.get(
        srcInside ? path.srcPointName : path.destPointName,
      );
      if (!outside || !inside) continue;

      aisleRefCoords.push(outside);
      depthDirX += inside.x - outside.x;
      depthDirY += inside.y - outside.y;
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
    for (const member of members) {
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

  private warnAboutLaneCellsWithoutASlot(
    zone: ZoneEntity,
    axesByLocation: ReadonlyMap<string, MemberAxes>,
    pointNamesByLocation: ReadonlyMap<string, string[]>,
    plantModel: KernelPlantModel,
  ): void {
    const paths = new Set(
      plantModel.paths.map((path) =>
        pathKey(path.srcPointName, path.destPointName),
      ),
    );
    const adjacent = (from: string[], to: string[]): boolean =>
      from.some((a) =>
        to.some((b) => paths.has(pathKey(a, b)) || paths.has(pathKey(b, a))),
      );

    const slotsByLane = new Map<number, string[]>();
    for (const [locationName, axes] of axesByLocation) {
      const slots = slotsByLane.get(axes.laneKey) ?? [];
      slots.push(locationName);
      slotsByLane.set(axes.laneKey, slots);
    }

    for (const [laneKey, slots] of slotsByLane) {
      const byDepth = slots.sort(
        (a, b) =>
          (axesByLocation.get(a)?.depthKey ?? 0) -
          (axesByLocation.get(b)?.depthKey ?? 0),
      );
      for (let i = 1; i < byDepth.length; i++) {
        const previous = pointNamesByLocation.get(byDepth[i - 1]) ?? [];
        const current = pointNamesByLocation.get(byDepth[i]) ?? [];
        if (adjacent(previous, current)) continue;
        this.logger.warn(
          `Zone "${zone.name}" lane ${laneKey}: no direct path between ` +
            `"${byDepth[i - 1]}" and "${byDepth[i]}", so the lane holds at least one cell ` +
            'without a slot. A vehicle standing on such a cell reads as out of the column, ' +
            'and the tasks behind it are released while it is still inside the lane.',
        );
        break;
      }
    }
  }
}

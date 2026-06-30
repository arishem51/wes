import { Injectable, Logger } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { ZoneEntity } from '../zones/entities/zone.entity';

const LOCATION_PREFIX = 'location_';
const GRID_ROUND = 1000;

interface PointCoords {
  x: number;
  y: number;
}

export interface MemberAxes {
  /** Distance band into the zone; smaller = closer to the aisle (outer). */
  depthKey: number;
  /** Position band along the aisle; identifies which lane a slot is in. */
  laneKey: number;
}

/**
 * Resolves the spatial layout of a zone's member slots relative to its aisle,
 * shared by the pickup row-dependency check (and available for any other
 * spatial reasoning over a zone).
 *
 * Two axes are derived from the plant model:
 *   - depth axis: the average "into the zone" direction of the paths entering
 *     the zone from outside; projection onto it gives `depthKey`.
 *   - lane axis: perpendicular to depth; projection gives `laneKey`.
 *
 * Assumes lanes are roughly straight and the zone is reachable via inbound
 * paths from an aisle outside it (ARCHITECTURE §6.3). Returns null when the
 * plant model is unavailable or no inbound path is found, so callers can fall
 * back to "no spatial constraint".
 */
@Injectable()
export class ZoneGeometryService {
  private readonly logger = new Logger(ZoneGeometryService.name);

  constructor(private readonly kernelApi: KernelApiService) {}

  async computeMemberAxes(
    zone: ZoneEntity,
  ): Promise<Map<string, MemberAxes> | null> {
    if (!zone.members || zone.members.length === 0) return null;

    const plantModel = (await this.kernelApi.getPlantModel()) as Record<
      string,
      unknown
    > | null;
    if (!plantModel) {
      this.logger.warn('computeMemberAxes: plant model unavailable');
      return null;
    }

    const rawPoints = Array.isArray(plantModel.points)
      ? (plantModel.points as Array<Record<string, unknown>>)
      : [];
    const rawPaths = Array.isArray(plantModel.paths)
      ? (plantModel.paths as Array<Record<string, unknown>>)
      : [];
    const rawLocations = Array.isArray(plantModel.locations)
      ? (plantModel.locations as Array<Record<string, unknown>>)
      : [];

    const pointMap = new Map<string, PointCoords>();
    for (const p of rawPoints) {
      if (typeof p.name !== 'string') continue;
      const pos = p.position as { x?: number; y?: number } | undefined;
      if (!pos) continue;
      pointMap.set(p.name, { x: pos.x ?? 0, y: pos.y ?? 0 });
    }

    const locationPointMap = new Map<string, string>();
    for (const loc of rawLocations) {
      if (typeof loc.name !== 'string') continue;
      const links = loc.links;
      if (Array.isArray(links) && links.length > 0) {
        const first = links[0] as Record<string, unknown>;
        const pn =
          typeof first.pointName === 'string'
            ? first.pointName
            : typeof first.point === 'string'
              ? first.point
              : null;
        if (pn) locationPointMap.set(loc.name, pn);
      } else if (links && typeof links === 'object' && !Array.isArray(links)) {
        const firstKey = Object.keys(links)[0];
        if (firstKey) locationPointMap.set(loc.name, firstKey);
      }
    }

    const pointOf = (locationName: string): string =>
      locationPointMap.get(locationName) ??
      this.locationToPointName(locationName);

    const memberPointNames = new Set<string>(
      zone.members.map((m) => pointOf(m.locationName)).filter(Boolean),
    );

    // Inbound paths (src outside the zone, dest inside) define the aisle:
    // their source coords give the aisle position, and (dest - src) the
    // direction into the zone.
    const aisleRefCoords: PointCoords[] = [];
    let depthDirX = 0;
    let depthDirY = 0;
    for (const path of rawPaths) {
      const dest = path.destPointName as string | undefined;
      const src = path.srcPointName as string | undefined;
      if (!dest || !src) continue;
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
    const dx = depthDirX / depthLen; // unit depth axis
    const dy = depthDirY / depthLen;
    // Lane axis is perpendicular to depth.
    const lx = -dy;
    const ly = dx;

    const result = new Map<string, MemberAxes>();
    for (const member of zone.members) {
      const coords = pointMap.get(pointOf(member.locationName));
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

  private locationToPointName(locationName: string): string {
    return locationName.startsWith(LOCATION_PREFIX)
      ? locationName.slice(LOCATION_PREFIX.length)
      : locationName;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { RoadEdge, RoadGraph, buildRoadGraph } from './domain/routing';

/**
 * Builds the warehouse road graph from the openTCS plant model so the
 * assignment engine can pick the nearest vehicle (ARCHITECTURE §6.1).
 *
 * Reads the same raw plant model as ZoneGeometryService: paths carry
 * `srcPointName`/`destPointName`/`length` at runtime. Returns null when the
 * plant model is unavailable so the caller can fall back to name-order picking.
 *
 * The graph is derived purely from the plant model, which changes rarely (map
 * upload, zone re-push, SSE reseed). Rather than rebuild every dispatch cycle,
 * we cache the graph and rebuild only when the plant model actually changes —
 * detected by object identity: `KernelApiService.getPlantModel()` returns the
 * same reference until its cache is invalidated, after which it fetches a fresh
 * object. So a changed reference ⇒ the model changed ⇒ rebuild.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  private cachedModel: unknown = null;
  private cachedGraph: RoadGraph | null = null;

  constructor(private readonly kernelApi: KernelApiService) {}

  async getRoadGraph(): Promise<RoadGraph | null> {
    const plantModel = await this.kernelApi.getPlantModel();
    if (!plantModel) {
      this.logger.warn('getRoadGraph: plant model unavailable');
      return null;
    }
    // Same plant-model instance as last build → reuse the cached graph.
    if (plantModel === this.cachedModel) return this.cachedGraph;

    this.cachedModel = plantModel;
    this.cachedGraph = this.build(plantModel as Record<string, unknown>);
    return this.cachedGraph;
  }

  private build(plantModel: Record<string, unknown>): RoadGraph | null {
    const rawPaths = Array.isArray(plantModel.paths)
      ? (plantModel.paths as Array<Record<string, unknown>>)
      : [];

    const edges: RoadEdge[] = [];
    for (const path of rawPaths) {
      // A locked path is closed to traffic — exclude it from routing.
      if (path.locked === true) continue;
      const from = path.srcPointName;
      const to = path.destPointName;
      if (typeof from !== 'string' || typeof to !== 'string') continue;
      const length = typeof path.length === 'number' ? path.length : 0;
      edges.push({ from, to, length });
    }

    if (edges.length === 0) {
      this.logger.warn('getRoadGraph: plant model has no usable paths');
      return null;
    }
    const graph = buildRoadGraph(edges);
    this.logger.log(
      `Road graph built: ${graph.size} point(s), ${edges.length} edge(s)`,
    );
    return graph;
  }
}

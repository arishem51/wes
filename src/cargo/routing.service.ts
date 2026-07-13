import { Injectable, Logger } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { RoadEdge, RoadGraph, buildRoadGraph } from './domain/routing';

type RawPath = Record<string, unknown>;

function isLocked(path: RawPath): boolean {
  return path.locked === true;
}

function toRoadEdge(path: RawPath): RoadEdge | null {
  const from = path.srcPointName;
  const to = path.destPointName;
  const maxVelocity = path.maxVelocity;
  const maxReverseVelocity = path.maxReverseVelocity;
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  if (
    typeof maxVelocity !== 'number' ||
    typeof maxReverseVelocity !== 'number'
  ) {
    return null;
  }
  const length = typeof path.length === 'number' ? path.length : 0;
  return { from, to, length, maxVelocity, maxReverseVelocity };
}

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
    const modelUnchangedSinceLastBuild = plantModel === this.cachedModel;
    if (modelUnchangedSinceLastBuild) return this.cachedGraph;

    this.cachedModel = plantModel;
    this.cachedGraph = this.build(plantModel as Record<string, unknown>);
    return this.cachedGraph;
  }

  private build(plantModel: Record<string, unknown>): RoadGraph | null {
    const rawPaths = Array.isArray(plantModel.paths)
      ? (plantModel.paths as RawPath[])
      : [];

    const openPaths = rawPaths.filter((path) => !isLocked(path));
    const edges = openPaths
      .map(toRoadEdge)
      .filter((edge): edge is RoadEdge => edge !== null);

    const unusablePaths = openPaths.length - edges.length;
    if (unusablePaths > 0) {
      this.logger.warn(
        `getRoadGraph: ${unusablePaths} path(s) excluded — missing endpoints or maxVelocity/maxReverseVelocity`,
      );
    }
    if (edges.length === 0) {
      this.logger.warn('getRoadGraph: plant model has no usable paths');
      return null;
    }

    const graph = buildRoadGraph(edges);
    const oneWayPaths = edges.filter(
      (edge) => edge.maxVelocity <= 0 || edge.maxReverseVelocity <= 0,
    ).length;
    this.logger.log(
      `Road graph built: ${graph.size} point(s), ${edges.length} path(s), ${oneWayPaths} one-way`,
    );
    return graph;
  }
}

import { ServiceUnavailableException } from '@nestjs/common';
import { KernelApiService } from './kernel-api.service';
import { savePlantModel } from './save-plant-model';

export type KernelLocationType = 'Pick up' | 'Drop off';

export interface MemberLocationSpec {
  locationName: string;
  pointName: string;
  type: KernelLocationType;
}

export interface KernelPath {
  srcPointName?: string;
  destPointName?: string;
  maxVelocity: number;
  maxReverseVelocity: number;
}

export interface PlantTopology {
  pointNames: Set<string>;
  locationLinks: Map<string, Set<string>>;
  paths: KernelPath[];
}

interface LocationMeta {
  useTypeNameKey: 'typeName' | 'type';
  useArrayLinks: boolean;
  layout?: Record<string, unknown>;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function requireModel(rawModel: unknown): Record<string, unknown> {
  if (!rawModel || typeof rawModel !== 'object') {
    throw new ServiceUnavailableException('Không thể kết nối kernel.');
  }
  return rawModel as Record<string, unknown>;
}

function extractLinkedPointNames(links: unknown): Set<string> {
  if (Array.isArray(links)) {
    return new Set(
      links
        .map((link) =>
          link && typeof link === 'object'
            ? ((link as { pointName?: unknown }).pointName ??
              (link as { point?: unknown }).point)
            : null,
        )
        .filter((name): name is string => typeof name === 'string'),
    );
  }
  if (links && typeof links === 'object') {
    return new Set(Object.keys(links));
  }
  return new Set();
}

function locationMetaFor(
  locations: Record<string, unknown>[],
  locationType: KernelLocationType,
): LocationMeta {
  const sample = locations.find(
    (location) => (location.typeName ?? location.type) === locationType,
  );
  return {
    useTypeNameKey: !sample || 'typeName' in sample ? 'typeName' : 'type',
    useArrayLinks: !sample || Array.isArray(sample.links),
    layout:
      sample?.layout && typeof sample.layout === 'object'
        ? { ...(sample.layout as Record<string, unknown>) }
        : undefined,
  };
}

function buildLocation(
  spec: MemberLocationSpec,
  points: Record<string, unknown>[],
  meta: LocationMeta,
): Record<string, unknown> {
  const point = points.find((candidate) => candidate.name === spec.pointName);
  const position = point?.position as Record<string, number> | undefined;
  const location: Record<string, unknown> = {
    name: spec.locationName,
    [meta.useTypeNameKey]: spec.type,
    position: { x: position?.x ?? 0, y: position?.y ?? 0, z: 0 },
    locked: false,
    links: meta.useArrayLinks
      ? [{ pointName: spec.pointName }]
      : { [spec.pointName]: [] },
  };
  if (meta.layout) location.layout = { ...meta.layout };
  return location;
}

function upsertInto(
  locations: Record<string, unknown>[],
  location: Record<string, unknown>,
): void {
  const index = locations.findIndex((item) => item.name === location.name);
  if (index >= 0) locations[index] = location;
  else locations.push(location);
}

export async function readPlantTopology(
  kernelApi: KernelApiService,
): Promise<PlantTopology | null> {
  const rawModel = await kernelApi.getPlantModel();
  if (!rawModel || typeof rawModel !== 'object') return null;

  const model = rawModel as Record<string, unknown>;
  const points = recordArray(model.points);
  const locations = recordArray(model.locations);
  const paths = recordArray(model.paths);
  const vehicles = recordArray(model.vehicles);
  const modelName = typeof model.name === 'string' ? model.name : null;
  if (
    modelName === 'unnamed' &&
    points.length === 0 &&
    locations.length === 0 &&
    paths.length === 0 &&
    vehicles.length === 0
  ) {
    return null;
  }

  const pointNames = new Set(
    points
      .map((point) => (typeof point.name === 'string' ? point.name : null))
      .filter((name): name is string => name !== null),
  );

  const locationLinks = new Map<string, Set<string>>();
  for (const location of locations) {
    if (typeof location.name !== 'string') continue;
    locationLinks.set(location.name, extractLinkedPointNames(location.links));
  }

  return { pointNames, locationLinks, paths: paths as unknown as KernelPath[] };
}

export async function upsertMemberLocations(
  kernelApi: KernelApiService,
  specs: MemberLocationSpec[],
): Promise<void> {
  if (specs.length === 0) return;
  const model = requireModel(await kernelApi.getPlantModel());
  const points = recordArray(model.points);
  const locations = [...recordArray(model.locations)];

  for (const spec of specs) {
    const meta = locationMetaFor(locations, spec.type);
    upsertInto(locations, buildLocation(spec, points, meta));
  }

  await savePlantModel(kernelApi, { ...model, locations });
}

export async function removeLocations(
  kernelApi: KernelApiService,
  locationNames: Iterable<string>,
): Promise<void> {
  const names = new Set(locationNames);
  if (names.size === 0) return;
  const model = requireModel(await kernelApi.getPlantModel());
  const locations = recordArray(model.locations).filter((location) => {
    const name = typeof location.name === 'string' ? location.name : undefined;
    return !name || !names.has(name);
  });
  await savePlantModel(kernelApi, { ...model, locations });
}

export const DROPOFF_RETREAT_CELLS = 2;

export interface RetreatGraphPoint {
  readonly name: string;
  readonly position: { readonly x: number; readonly y: number };
}

export interface RetreatGraphPath {
  readonly srcPointName?: string;
  readonly destPointName?: string;
  readonly maxVelocity: number;
  readonly maxReverseVelocity: number;
  readonly locked?: boolean;
}

export interface RetreatGraph {
  readonly points: readonly RetreatGraphPoint[];
  readonly paths: readonly RetreatGraphPath[];
}

function traversableTargets(
  paths: readonly RetreatGraphPath[],
): Map<string, Set<string>> {
  const targets = new Map<string, Set<string>>();
  const connect = (from: string, to: string): void => {
    const existing = targets.get(from);
    if (existing) existing.add(to);
    else targets.set(from, new Set([to]));
  };

  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest || path.locked) continue;
    if (path.maxVelocity > 0) connect(src, dest);
    if (path.maxReverseVelocity > 0) connect(dest, src);
  }
  return targets;
}

function isBehind(
  candidate: RetreatGraphPoint,
  current: RetreatGraphPoint,
): boolean {
  return (
    candidate.position.x === current.position.x &&
    candidate.position.y > current.position.y
  );
}

function nearestCellBehind(
  current: RetreatGraphPoint,
  points: readonly RetreatGraphPoint[],
): RetreatGraphPoint | null {
  let nearest: RetreatGraphPoint | null = null;
  let nearestGap = Infinity;
  for (const candidate of points) {
    if (!isBehind(candidate, current)) continue;
    const gap = candidate.position.y - current.position.y;
    if (gap >= nearestGap) continue;
    nearest = candidate;
    nearestGap = gap;
  }
  return nearest;
}

export function resolveRetreatPath(
  graph: RetreatGraph,
  dropPointName: string,
  cells: number = DROPOFF_RETREAT_CELLS,
): string[] | null {
  if (cells < 1) return null;

  const start = graph.points.find((point) => point.name === dropPointName);
  if (!start) return null;

  const reachableFrom = traversableTargets(graph.paths);
  const visited = new Set<string>([start.name]);
  const walk: string[] = [];
  let current = start;

  for (let cell = 0; cell < cells; cell++) {
    const behind = nearestCellBehind(current, graph.points);
    if (!behind || visited.has(behind.name)) return null;
    if (!reachableFrom.get(current.name)?.has(behind.name)) return null;
    visited.add(behind.name);
    walk.push(behind.name);
    current = behind;
  }
  return walk;
}

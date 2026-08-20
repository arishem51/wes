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

export interface RetreatPlan {
  readonly cells: readonly string[];
  readonly egress: string | null;
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

interface Walk {
  readonly cells: string[];
  readonly visited: Set<string>;
  current: RetreatGraphPoint;
}

function stepBehind(
  walk: Walk,
  points: readonly RetreatGraphPoint[],
  reachableFrom: ReadonlyMap<string, Set<string>>,
): boolean {
  const behind = nearestCellBehind(walk.current, points);
  if (!behind || walk.visited.has(behind.name)) return false;
  if (!reachableFrom.get(walk.current.name)?.has(behind.name)) return false;
  walk.visited.add(behind.name);
  walk.cells.push(behind.name);
  walk.current = behind;
  return true;
}

function sidewaysNeighbour(
  from: RetreatGraphPoint,
  pointByName: ReadonlyMap<string, RetreatGraphPoint>,
  reachableFrom: ReadonlyMap<string, Set<string>>,
): RetreatGraphPoint | null {
  let firstByName: RetreatGraphPoint | null = null;
  for (const name of reachableFrom.get(from.name) ?? []) {
    const point = pointByName.get(name);
    if (!point || point.position.x === from.position.x) continue;
    if (firstByName && firstByName.name.localeCompare(point.name) <= 0)
      continue;
    firstByName = point;
  }
  return firstByName;
}

function turnOffEveryLaneFrom(
  from: RetreatGraphPoint,
  pointByName: ReadonlyMap<string, RetreatGraphPoint>,
  reachableFrom: ReadonlyMap<string, Set<string>>,
  laneAxisPointNames: ReadonlySet<string>,
  occupiedPointNames: ReadonlySet<string>,
): string | null {
  const crossed = new Set([from.name]);
  let current = from;
  for (;;) {
    const next = sidewaysNeighbour(current, pointByName, reachableFrom);
    if (!next || crossed.has(next.name)) return null;
    if (!laneAxisPointNames.has(next.name)) return next.name;
    if (occupiedPointNames.has(next.name)) return null;
    crossed.add(next.name);
    current = next;
  }
}

function walkBehind(
  graph: RetreatGraph,
  dropPointName: string,
  cells: number,
): { walk: Walk; reachableFrom: ReadonlyMap<string, Set<string>> } | null {
  if (cells < 1) return null;
  const start = graph.points.find((point) => point.name === dropPointName);
  if (!start) return null;

  const reachableFrom = traversableTargets(graph.paths);
  const walk: Walk = {
    cells: [],
    visited: new Set([start.name]),
    current: start,
  };
  for (let cell = 0; cell < cells; cell++) {
    if (!stepBehind(walk, graph.points, reachableFrom)) return null;
  }
  return { walk, reachableFrom };
}

export function behindChain(
  graph: RetreatGraph,
  fromPointName: string,
): string[] {
  const start = graph.points.find((point) => point.name === fromPointName);
  if (!start) return [];

  const reachableFrom = traversableTargets(graph.paths);
  const walk: Walk = {
    cells: [],
    visited: new Set([start.name]),
    current: start,
  };
  while (stepBehind(walk, graph.points, reachableFrom)) {
    continue;
  }
  return walk.cells;
}

export function resolveRetreatPath(
  graph: RetreatGraph,
  dropPointName: string,
  cells: number = DROPOFF_RETREAT_CELLS,
): string[] | null {
  return walkBehind(graph, dropPointName, cells)?.walk.cells ?? null;
}

export function resolveRetreatPlan(
  graph: RetreatGraph,
  dropPointName: string,
  laneAxisPointNames: ReadonlySet<string>,
  occupiedPointNames: ReadonlySet<string>,
  cells: number = DROPOFF_RETREAT_CELLS,
): RetreatPlan | null {
  const walked = walkBehind(graph, dropPointName, cells);
  if (!walked) return null;

  const { walk, reachableFrom } = walked;
  const pointByName = new Map(
    graph.points.map((point) => [point.name, point] as const),
  );

  while (laneAxisPointNames.has(walk.current.name)) {
    const turn = turnOffEveryLaneFrom(
      walk.current,
      pointByName,
      reachableFrom,
      laneAxisPointNames,
      occupiedPointNames,
    );
    if (turn) return { cells: walk.cells, egress: turn };
    if (!stepBehind(walk, graph.points, reachableFrom)) return null;
  }
  return { cells: walk.cells, egress: null };
}

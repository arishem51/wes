export interface PlantPath {
  srcPointName?: string;
  destPointName?: string;
  maxVelocity: number;
  maxReverseVelocity: number;
}

interface Arc {
  readonly from: string;
  readonly to: string;
}

function directedArcs(paths: readonly PlantPath[]): Arc[] {
  const arcs: Arc[] = [];
  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest) continue;
    if (path.maxVelocity > 0) arcs.push({ from: src, to: dest });
    if (path.maxReverseVelocity > 0) arcs.push({ from: dest, to: src });
  }
  return arcs;
}

function adjacency(arcs: readonly Arc[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const arc of arcs) {
    const list = adj.get(arc.from);
    if (list) list.push(arc.to);
    else adj.set(arc.from, [arc.to]);
  }
  return adj;
}

function bfs(
  adj: ReadonlyMap<string, string[]>,
  starts: readonly string[],
): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const start of starts) {
    if (dist.has(start)) continue;
    dist.set(start, 0);
    queue.push(start);
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const nodeDist = dist.get(node)!;
    for (const next of adj.get(node) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, nodeDist + 1);
      queue.push(next);
    }
  }
  return dist;
}

export function computeFeederPoints(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
): string[] {
  const feeders = new Set<string>();
  for (const arc of directedArcs(paths)) {
    const entersZone =
      memberPointNames.has(arc.to) && !memberPointNames.has(arc.from);
    if (entersZone) feeders.add(arc.to);
  }
  return [...feeders];
}

export function computeEgressPoints(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
): string[] {
  const egress = new Set<string>();
  for (const arc of directedArcs(paths)) {
    const leavesZone =
      memberPointNames.has(arc.from) && !memberPointNames.has(arc.to);
    if (leavesZone) egress.add(arc.to);
  }
  return [...egress];
}

export function hopsToExit(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
  egressPoints: readonly string[],
): Map<string, number> {
  const arcsTowardExit = directedArcs(paths).map((arc) => ({
    from: arc.to,
    to: arc.from,
  }));
  const dist = bfs(adjacency(arcsTowardExit), egressPoints);

  const hops = new Map<string, number>();
  for (const member of memberPointNames) {
    const d = dist.get(member);
    if (d != null) hops.set(member, d);
  }
  return hops;
}

export interface ReachabilityResult {
  feeders: string[];
  unreachable: string[];
  maxHops: number;
}

export function checkZoneReachability(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
): ReachabilityResult {
  const feeders = computeFeederPoints(paths, memberPointNames);
  const adj = adjacency(directedArcs(paths));

  const members = [...memberPointNames];
  const unreachable = new Set<string>();
  let maxHops = 0;

  for (const feeder of feeders) {
    const dist = bfs(adj, [feeder]);
    for (const member of members) {
      const d = dist.get(member);
      if (d == null) unreachable.add(member);
      else if (d > maxHops) maxHops = d;
    }
  }

  return { feeders, unreachable: [...unreachable], maxHops };
}

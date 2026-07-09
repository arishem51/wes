/**
 * Pure topology helpers over a kernel plant model. Shared by dropoff-zone
 * construction (which point(s) the parent `zone_<id>` location links to) and,
 * later, the zone reachability guard. No I/O — callers pass the parsed model.
 */

/** A plant-model path as returned by the kernel: a directed edge src → dest. */
export interface PlantPath {
  srcPointName?: string;
  destPointName?: string;
}

/**
 * Feeder points of a zone: the entry-most MEMBER points (aisle "heads") — member
 * points that have a path leading directly INTO them from OUTSIDE the zone. A
 * vehicle enters the zone by first arriving at one of these heads.
 *
 * The parent `zone_<id>` location links to these heads (not the external point
 * before them on the mainline, and not every member): a NOP approach then stops
 * the vehicle AT an aisle head — off the through-lane — instead of waiting on the
 * mainline. Linking the parent to all member points instead lets the router
 * greedily stop at the nearest member deep inside a lane, forcing a detour on
 * one-way maps.
 *
 * NOTE: when a zone has more than one head, the heads may cross-connect only one
 * way (or only via the mainline). {@link checkZoneReachability} still guards that
 * every slot is reachable from every head, but a committed slot in the "other"
 * column can cost a mainline round-trip from the head the vehicle stopped at.
 *
 * Returns the *member-side* endpoint of each external→member edge. Returns [] when
 * no external inbound path exists; callers fall back to linking all member points.
 */
export function computeFeederPoints(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
): string[] {
  const feeders = new Set<string>();
  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest) continue;
    if (memberPointNames.has(dest) && !memberPointNames.has(src)) {
      // The aisle head is the member point being entered (dest), not the
      // external point (src) that feeds it — so the approach stops inside the
      // zone at the head rather than on the mainline.
      feeders.add(dest);
    }
  }
  return [...feeders];
}

/**
 * Egress points of a zone: points OUTSIDE the zone that a member point has a
 * path leading INTO — i.e. where the flow leaves the zone toward the exit.
 * Outbound counterpart of {@link computeFeederPoints} (this keeps the external
 * exit point; the feeder keeps the internal member head). Returns [] when none.
 */
export function computeEgressPoints(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
): string[] {
  const egress = new Set<string>();
  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest) continue;
    if (memberPointNames.has(src) && !memberPointNames.has(dest)) {
      egress.add(dest);
    }
  }
  return [...egress];
}

/**
 * Forward hop distance from each member slot to the nearest egress (exit) point,
 * along the directed path graph — computed by a multi-source BFS from the egress
 * points over the *reversed* edges. Larger value = deeper in the flow / farther
 * from the exit; drop-off fills farthest-from-exit slots first so a later drop
 * never sits between an earlier one and the exit. Members with no path to any
 * egress are omitted (they can't reach the exit).
 */
export function hopsToExit(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
  egressPoints: readonly string[],
): Map<string, number> {
  const reverse = new Map<string, string[]>();
  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest) continue;
    const list = reverse.get(dest);
    if (list) list.push(src);
    else reverse.set(dest, [src]);
  }

  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const e of egressPoints) {
    if (!dist.has(e)) {
      dist.set(e, 0);
      queue.push(e);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const nodeDist = dist.get(node)!;
    for (const prev of reverse.get(node) ?? []) {
      if (!dist.has(prev)) {
        dist.set(prev, nodeDist + 1);
        queue.push(prev);
      }
    }
  }

  const result = new Map<string, number>();
  for (const member of memberPointNames) {
    const d = dist.get(member);
    if (d != null) result.set(member, d);
  }
  return result;
}

export interface ReachabilityResult {
  /** Feeder (aisle head) points the NOP approach can stop at. */
  feeders: string[];
  /**
   * Member points not forward-reachable from **at least one** feeder. Since the
   * approach location links all feeders and the router may stop at any of them,
   * a member must be reachable from every feeder to guarantee no dead end.
   * Non-empty ⇒ the zone would strand a vehicle → hard block.
   */
  unreachable: string[];
  /** Largest feeder→member hop distance (a long value signals a detour). */
  maxHops: number;
}

/**
 * Verifies that every member slot is forward-reachable from the zone's feeders
 * on the directed path graph — the same graph openTCS routes on. Config-time
 * guard so a bad layout is rejected up front instead of stranding a vehicle at
 * the TO2 barrier.
 *
 * When there are no feeders the result is empty/unreachable=[] (the caller can't
 * verify and should fall back / warn, not block).
 */
export function checkZoneReachability(
  paths: readonly PlantPath[],
  memberPointNames: ReadonlySet<string>,
): ReachabilityResult {
  const feeders = computeFeederPoints(paths, memberPointNames);

  const adj = new Map<string, string[]>();
  for (const path of paths) {
    const src = path.srcPointName;
    const dest = path.destPointName;
    if (!src || !dest) continue;
    const list = adj.get(src);
    if (list) list.push(dest);
    else adj.set(src, [dest]);
  }

  const members = [...memberPointNames];
  const unreachable = new Set<string>();
  let maxHops = 0;

  for (const feeder of feeders) {
    const dist = bfs(adj, feeder);
    for (const member of members) {
      const d = dist.get(member);
      if (d == null) unreachable.add(member);
      else if (d > maxHops) maxHops = d;
    }
  }

  return { feeders, unreachable: [...unreachable], maxHops };
}

function bfs(
  adj: ReadonlyMap<string, string[]>,
  start: string,
): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  const queue: string[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const nodeDist = dist.get(node)!;
    for (const next of adj.get(node) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, nodeDist + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

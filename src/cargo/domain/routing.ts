/**
 * Pure road-graph routing (WF / ARCHITECTURE §6.1).
 *
 * Builds an undirected weighted graph from the openTCS plant-model paths and
 * answers "how far is every point from a given source" via Dijkstra. Kept pure
 * (primitives only, no TypeORM/openTCS types) so the nearest-vehicle rule is a
 * single readable, unit-testable function. The Hungarian dispatch policy
 * consumes the same distances without coupling routing to assignment.
 */

/** One openTCS path, flattened to its routing-relevant fields. */
export interface RoadEdge {
  readonly from: string;
  readonly to: string;
  /** Path length in the plant-model unit (openTCS reports mm). */
  readonly length: number;
  /** openTCS path attribute; > 0 means the path is drivable backward too. */
  readonly maxReverseVelocity?: number;
}

/** Adjacency list: point name → its neighbours and edge weights. */
export type RoadGraph = ReadonlyMap<
  string,
  ReadonlyArray<{ to: string; length: number }>
>;

/**
 * Build a directed graph matching how the kernel actually routes: an openTCS
 * path is one-way src→dest unless `maxReverseVelocity > 0`, in which case the
 * reverse direction is drivable too. Non-finite or negative lengths are clamped
 * to 0 (Dijkstra requires non-negative weights).
 */
export function buildRoadGraph(edges: readonly RoadEdge[]): RoadGraph {
  const graph = new Map<string, Array<{ to: string; length: number }>>();
  const link = (a: string, b: string, length: number): void => {
    const list = graph.get(a);
    if (list) list.push({ to: b, length });
    else graph.set(a, [{ to: b, length }]);
  };
  for (const edge of edges) {
    if (!edge.from || !edge.to) continue;
    const length =
      Number.isFinite(edge.length) && edge.length > 0 ? edge.length : 0;
    link(edge.from, edge.to, length);
    if ((edge.maxReverseVelocity ?? 0) > 0) link(edge.to, edge.from, length);
  }
  return graph;
}

/**
 * Flip every edge. Dijkstra FROM a target on the reversed graph yields each
 * point's driving distance TO that target on the original directed graph —
 * the vehicle→pickup cost the assignment engine needs.
 */
export function reverseRoadGraph(graph: RoadGraph): RoadGraph {
  const reversed = new Map<string, Array<{ to: string; length: number }>>();
  for (const node of graph.keys()) reversed.set(node, []);
  for (const [from, edges] of graph) {
    for (const edge of edges) {
      const list = reversed.get(edge.to);
      if (list) list.push({ to: from, length: edge.length });
      else reversed.set(edge.to, [{ to: from, length: edge.length }]);
    }
  }
  return reversed;
}

/**
 * Dijkstra single-source shortest path. Returns the distance from `source` to
 * every reachable node (source included, at 0). Unreachable nodes are absent —
 * callers treat "absent" as unreachable (Infinity). Uses a binary min-heap so a
 * warehouse graph of thousands of points routes in O(E log V) per call.
 */
export function shortestDistancesFrom(
  graph: RoadGraph,
  source: string,
): Map<string, number> {
  const dist = new Map<string, number>();
  if (!graph.has(source)) return dist;

  const heap = new MinHeap();
  dist.set(source, 0);
  heap.push(source, 0);

  while (heap.size > 0) {
    const { node, priority } = heap.pop();
    // Stale entry: a shorter distance was already finalised for this node.
    if (priority > (dist.get(node) ?? Infinity)) continue;
    for (const edge of graph.get(node) ?? []) {
      const next = priority + edge.length;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        heap.push(edge.to, next);
      }
    }
  }
  return dist;
}

/** Minimal binary min-heap keyed on a numeric priority. */
class MinHeap {
  private readonly items: Array<{ node: string; priority: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(node: string, priority: number): void {
    const items = this.items;
    items.push({ node, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { node: string; priority: number } {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (
          left < items.length &&
          items[left].priority < items[smallest].priority
        )
          smallest = left;
        if (
          right < items.length &&
          items[right].priority < items[smallest].priority
        )
          smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

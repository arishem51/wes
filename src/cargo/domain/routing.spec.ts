import {
  buildRoadGraph,
  reverseRoadGraph,
  shortestDistancesFrom,
} from './routing';

describe('routing', () => {
  describe('buildRoadGraph', () => {
    it('is directed — a plain edge is one-way src→dest', () => {
      const graph = buildRoadGraph([{ from: 'A', to: 'B', length: 5 }]);
      expect(shortestDistancesFrom(graph, 'A').get('B')).toBe(5);
      expect(shortestDistancesFrom(graph, 'B').has('A')).toBe(false);
    });

    it('adds the reverse direction when maxReverseVelocity > 0', () => {
      const graph = buildRoadGraph([
        { from: 'A', to: 'B', length: 5, maxReverseVelocity: 300 },
      ]);
      expect(shortestDistancesFrom(graph, 'A').get('B')).toBe(5);
      expect(shortestDistancesFrom(graph, 'B').get('A')).toBe(5);
    });

    it('treats maxReverseVelocity 0 or absent as one-way', () => {
      const graph = buildRoadGraph([
        { from: 'A', to: 'B', length: 5, maxReverseVelocity: 0 },
      ]);
      expect(shortestDistancesFrom(graph, 'B').has('A')).toBe(false);
    });

    it('clamps non-finite or negative lengths to 0', () => {
      const graph = buildRoadGraph([
        { from: 'A', to: 'B', length: -3 },
        { from: 'B', to: 'C', length: Number.NaN },
      ]);
      const dist = shortestDistancesFrom(graph, 'A');
      expect(dist.get('B')).toBe(0);
      expect(dist.get('C')).toBe(0);
    });

    it('skips edges missing an endpoint', () => {
      const graph = buildRoadGraph([{ from: '', to: 'B', length: 5 }]);
      expect(graph.size).toBe(0);
    });
  });

  describe('reverseRoadGraph', () => {
    it('flips every edge so Dijkstra-from-target yields into-target distance', () => {
      // One-way lane A→B→C. Driving distance TO C: from A = 2, from B = 1.
      const forward = buildRoadGraph([
        { from: 'A', to: 'B', length: 1 },
        { from: 'B', to: 'C', length: 1 },
      ]);
      const intoC = shortestDistancesFrom(reverseRoadGraph(forward), 'C');
      expect(intoC.get('A')).toBe(2);
      expect(intoC.get('B')).toBe(1);
    });

    it('keeps a bidirectional edge bidirectional', () => {
      const forward = buildRoadGraph([
        { from: 'A', to: 'B', length: 4, maxReverseVelocity: 1 },
      ]);
      const reversed = reverseRoadGraph(forward);
      expect(shortestDistancesFrom(reversed, 'A').get('B')).toBe(4);
      expect(shortestDistancesFrom(reversed, 'B').get('A')).toBe(4);
    });

    it('exposes a vehicle trapped in a one-way pocket as unreachable', () => {
      // Entry MAIN→TRAP exists, no exit. Distance TO the pickup (on MAIN)
      // from inside the trap must be absent — the kernel cannot route it.
      const forward = buildRoadGraph([
        { from: 'MAIN', to: 'TRAP', length: 1 },
        { from: 'MAIN', to: 'PICKUP', length: 1, maxReverseVelocity: 1 },
      ]);
      const intoPickup = shortestDistancesFrom(
        reverseRoadGraph(forward),
        'PICKUP',
      );
      expect(intoPickup.get('MAIN')).toBe(1);
      expect(intoPickup.has('TRAP')).toBe(false);
    });

    it('keeps sink-only nodes present as sources in the reversed graph', () => {
      const forward = buildRoadGraph([{ from: 'A', to: 'B', length: 1 }]);
      const reversed = reverseRoadGraph(forward);
      expect(shortestDistancesFrom(reversed, 'B').get('A')).toBe(1);
    });
  });

  describe('shortestDistancesFrom', () => {
    const graph = buildRoadGraph([
      { from: 'A', to: 'B', length: 1, maxReverseVelocity: 1 },
      { from: 'B', to: 'C', length: 1, maxReverseVelocity: 1 },
      { from: 'A', to: 'C', length: 5, maxReverseVelocity: 1 },
    ]);

    it('finds the shortest multi-hop path over a direct longer edge', () => {
      const dist = shortestDistancesFrom(graph, 'A');
      expect(dist.get('A')).toBe(0);
      expect(dist.get('B')).toBe(1);
      expect(dist.get('C')).toBe(2);
    });

    it('returns an empty map for an unknown source', () => {
      expect(shortestDistancesFrom(graph, 'Z').size).toBe(0);
    });

    it('omits unreachable nodes', () => {
      const disjoint = buildRoadGraph([
        { from: 'A', to: 'B', length: 1 },
        { from: 'X', to: 'Y', length: 1 },
      ]);
      const dist = shortestDistancesFrom(disjoint, 'A');
      expect(dist.has('X')).toBe(false);
      expect(dist.has('Y')).toBe(false);
    });
  });
});

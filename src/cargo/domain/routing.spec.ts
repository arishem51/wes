import { buildRoadGraph, shortestDistancesFrom } from './routing';

describe('routing', () => {
  describe('buildRoadGraph', () => {
    it('is undirected — an edge is traversable both ways', () => {
      const graph = buildRoadGraph([{ from: 'A', to: 'B', length: 5 }]);
      expect(shortestDistancesFrom(graph, 'A').get('B')).toBe(5);
      expect(shortestDistancesFrom(graph, 'B').get('A')).toBe(5);
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

  describe('shortestDistancesFrom', () => {
    // A—1—B—1—C   and   A—5—C : shortest A→C is 2 via B, not the direct 5.
    const graph = buildRoadGraph([
      { from: 'A', to: 'B', length: 1 },
      { from: 'B', to: 'C', length: 1 },
      { from: 'A', to: 'C', length: 5 },
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

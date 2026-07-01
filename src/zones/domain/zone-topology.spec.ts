import {
  checkZoneReachability,
  computeEgressPoints,
  computeFeederPoints,
  hopsToExit,
  type PlantPath,
} from './zone-topology';

describe('computeFeederPoints', () => {
  // A 2-column slice of map v7: columns A (3041→3042) and B (3049→3050) hang
  // below a one-way top aisle 0011→0012→0013. 0013 feeds column A, 0012 feeds
  // column B; storage rows cross A→B.
  const v7Slice: PlantPath[] = [
    { srcPointName: '0011', destPointName: '0012' },
    { srcPointName: '0012', destPointName: '0013' },
    { srcPointName: '0013', destPointName: '3041' }, // feeder → member
    { srcPointName: '0012', destPointName: '3049' }, // feeder → member
    { srcPointName: '3041', destPointName: '3042' }, // member → member
    { srcPointName: '3041', destPointName: '3049' }, // member → member (cross)
    { srcPointName: '3049', destPointName: '3050' }, // member → member
    { srcPointName: '3042', destPointName: '3050' }, // member → member (cross)
  ];
  const members = new Set(['3041', '3042', '3049', '3050']);

  it('returns only the external points feeding into a member', () => {
    expect(computeFeederPoints(v7Slice, members).sort()).toEqual([
      '0012',
      '0013',
    ]);
  });

  it('does not include member→member edges as feeders', () => {
    const feeders = computeFeederPoints(v7Slice, members);
    expect(feeders).not.toContain('3041');
    expect(feeders).not.toContain('3042');
  });

  it('dedups when several members share one feeder', () => {
    const paths: PlantPath[] = [
      { srcPointName: '0012', destPointName: '3049' },
      { srcPointName: '0012', destPointName: '3050' },
    ];
    expect(computeFeederPoints(paths, new Set(['3049', '3050']))).toEqual([
      '0012',
    ]);
  });

  it('returns [] when no external inbound path exists (fallback case)', () => {
    const paths: PlantPath[] = [
      { srcPointName: '3041', destPointName: '3042' },
      { srcPointName: '3042', destPointName: '3043' },
    ];
    expect(
      computeFeederPoints(paths, new Set(['3041', '3042', '3043'])),
    ).toEqual([]);
  });

  it('ignores paths with missing endpoints', () => {
    const paths: PlantPath[] = [
      { srcPointName: '0012' },
      { destPointName: '3049' },
      { srcPointName: '0012', destPointName: '3049' },
    ];
    expect(computeFeederPoints(paths, new Set(['3049']))).toEqual(['0012']);
  });
});

describe('checkZoneReachability', () => {
  // Same v7 slice: both feeders (0012, 0013) reach every member.
  const v7Slice: PlantPath[] = [
    { srcPointName: '0011', destPointName: '0012' },
    { srcPointName: '0012', destPointName: '0013' },
    { srcPointName: '0013', destPointName: '3041' },
    { srcPointName: '0012', destPointName: '3049' },
    { srcPointName: '3041', destPointName: '3042' },
    { srcPointName: '3041', destPointName: '3049' },
    { srcPointName: '3049', destPointName: '3050' },
    { srcPointName: '3042', destPointName: '3050' },
  ];
  const members = new Set(['3041', '3042', '3049', '3050']);

  it('reports every member reachable and no detour on a well-formed zone', () => {
    const r = checkZoneReachability(v7Slice, members);
    expect(r.feeders.sort()).toEqual(['0012', '0013']);
    expect(r.unreachable).toEqual([]);
    expect(r.maxHops).toBeGreaterThan(0);
  });

  it('flags a member unreachable from a feeder as unreachable (block case)', () => {
    // Add an isolated member 9999 fed by nothing external and reachable from no
    // feeder → must appear in unreachable.
    const paths: PlantPath[] = [
      ...v7Slice,
      { srcPointName: '9999', destPointName: '3041' }, // 9999 has no inbound
    ];
    const withIsolated = new Set([...members, '9999']);
    const r = checkZoneReachability(paths, withIsolated);
    expect(r.unreachable).toContain('9999');
  });

  it('flags members not reachable from EVERY feeder (strict) → block', () => {
    // Feeders don't cross-connect: 0013 reaches only 3041/3042, 0012 only 3049.
    // Since the router may stop at either feeder, a member reachable from just
    // one is unsafe. Here every member fails from some feeder → all flagged.
    const paths: PlantPath[] = [
      { srcPointName: '0013', destPointName: '3041' },
      { srcPointName: '3041', destPointName: '3042' },
      { srcPointName: '0012', destPointName: '3049' },
    ];
    const m = new Set(['3041', '3042', '3049']);
    const r = checkZoneReachability(paths, m);
    expect(r.feeders.sort()).toEqual(['0012', '0013']);
    expect(r.unreachable.sort()).toEqual(['3041', '3042', '3049']);
  });

  it('returns empty when there are no feeders (cannot verify)', () => {
    const paths: PlantPath[] = [
      { srcPointName: '3041', destPointName: '3042' },
    ];
    const r = checkZoneReachability(paths, new Set(['3041', '3042']));
    expect(r.feeders).toEqual([]);
    expect(r.unreachable).toEqual([]);
  });
});

describe('computeEgressPoints / hopsToExit', () => {
  // A single 3-slot lane flowing toward the exit:
  //   entry → A → B → C → EXIT   (A farthest from exit, C nearest)
  const members = new Set(['A', 'B', 'C']);
  const lane: PlantPath[] = [
    { srcPointName: 'entry', destPointName: 'A' }, // feeder → A
    { srcPointName: 'A', destPointName: 'B' },
    { srcPointName: 'B', destPointName: 'C' },
    { srcPointName: 'C', destPointName: 'EXIT' }, // C → outside (egress)
  ];

  it('detects egress = external points a member flows into', () => {
    expect(computeEgressPoints(lane, members)).toEqual(['EXIT']);
    // entry is inbound (feeder), not egress
    expect(computeEgressPoints(lane, members)).not.toContain('entry');
  });

  it('ranks members by forward hops to the exit (farther = larger)', () => {
    const hops = hopsToExit(lane, members, ['EXIT']);
    expect(hops.get('C')).toBe(1); // C → EXIT
    expect(hops.get('B')).toBe(2); // B → C → EXIT
    expect(hops.get('A')).toBe(3); // A → B → C → EXIT
  });

  it('omits members with no path to the exit', () => {
    const paths: PlantPath[] = [
      { srcPointName: 'A', destPointName: 'B' },
      { srcPointName: 'B', destPointName: 'EXIT' },
      // C is isolated — no way out
    ];
    const hops = hopsToExit(paths, new Set(['A', 'B', 'C']), ['EXIT']);
    expect(hops.get('A')).toBe(2);
    expect(hops.get('B')).toBe(1);
    expect(hops.has('C')).toBe(false);
  });
});

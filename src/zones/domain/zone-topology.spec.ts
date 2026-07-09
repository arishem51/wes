import {
  checkZoneReachability,
  computeEgressPoints,
  computeFeederPoints,
  hopsToExit,
  type PlantPath,
} from './zone-topology';

describe('computeFeederPoints', () => {
  // A 2-column slice of map v7: columns A (3041→3042) and B (3049→3050) hang
  // below a one-way top aisle 0011→0012→0013. 0013 feeds head A (3041), 0012
  // feeds head B (3049); a one-way cross A→B links the heads, and column B
  // rejoins the mainline via 3049→3057→0011.
  const v7Slice: PlantPath[] = [
    { srcPointName: '0011', destPointName: '0012' },
    { srcPointName: '0012', destPointName: '0013' },
    { srcPointName: '0013', destPointName: '3041' }, // external → head A
    { srcPointName: '0012', destPointName: '3049' }, // external → head B
    { srcPointName: '3041', destPointName: '3042' }, // member → member
    { srcPointName: '3041', destPointName: '3049' }, // member → member (cross A→B)
    { srcPointName: '3049', destPointName: '3050' }, // member → member
    { srcPointName: '3049', destPointName: '3057' }, // column B connector...
    { srcPointName: '3057', destPointName: '0011' }, // ...back onto the mainline
  ];
  const members = new Set(['3041', '3042', '3049', '3050']);

  it('returns the entry-most member points (aisle heads), not the external points', () => {
    expect(computeFeederPoints(v7Slice, members).sort()).toEqual([
      '3041',
      '3049',
    ]);
  });

  it('excludes members reachable only from inside the zone (no external inbound)', () => {
    const feeders = computeFeederPoints(v7Slice, members);
    // 3042 / 3050 are only ever entered from another member → not heads.
    expect(feeders).not.toContain('3042');
    expect(feeders).not.toContain('3050');
  });

  it('dedups when one member head has several external feeders', () => {
    const paths: PlantPath[] = [
      { srcPointName: '0011', destPointName: '3049' },
      { srcPointName: '0012', destPointName: '3049' },
    ];
    expect(computeFeederPoints(paths, new Set(['3049']))).toEqual(['3049']);
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
    expect(computeFeederPoints(paths, new Set(['3049']))).toEqual(['3049']);
  });
});

describe('checkZoneReachability', () => {
  // Same v7 slice: both heads (3041, 3049) reach every member — head B (3049)
  // reaches column A only via the mainline round-trip 3049→3057→0011→…→3041.
  const v7Slice: PlantPath[] = [
    { srcPointName: '0011', destPointName: '0012' },
    { srcPointName: '0012', destPointName: '0013' },
    { srcPointName: '0013', destPointName: '3041' },
    { srcPointName: '0012', destPointName: '3049' },
    { srcPointName: '3041', destPointName: '3042' },
    { srcPointName: '3041', destPointName: '3049' },
    { srcPointName: '3049', destPointName: '3050' },
    { srcPointName: '3049', destPointName: '3057' },
    { srcPointName: '3057', destPointName: '0011' },
  ];
  const members = new Set(['3041', '3042', '3049', '3050']);

  it('reports every member reachable from every head on a well-formed zone', () => {
    const r = checkZoneReachability(v7Slice, members);
    expect(r.feeders.sort()).toEqual(['3041', '3049']);
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

  it('flags members not reachable from EVERY head (strict) → block', () => {
    // Heads don't cross-connect: head 3041 reaches only 3041/3042, head 3049
    // only itself. Since the router may stop at either head, a member reachable
    // from just one is unsafe. Here every member fails from some head → all
    // flagged.
    const paths: PlantPath[] = [
      { srcPointName: '0013', destPointName: '3041' },
      { srcPointName: '3041', destPointName: '3042' },
      { srcPointName: '0012', destPointName: '3049' },
    ];
    const m = new Set(['3041', '3042', '3049']);
    const r = checkZoneReachability(paths, m);
    expect(r.feeders.sort()).toEqual(['3041', '3049']);
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

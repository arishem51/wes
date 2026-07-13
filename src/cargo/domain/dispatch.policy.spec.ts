import {
  VehicleCandidate,
  isEligible,
  planVehicleAssignments,
  pickVehicle,
  pickNearestVehicle,
} from './dispatch.policy';

const candidate = (
  overrides: Partial<VehicleCandidate> = {},
): VehicleCandidate => ({
  name: 'Vehicle-0001',
  dispatchEnabled: true,
  ignored: false,
  available: true,
  preemptibleParking: false,
  parkOrderName: null,
  energyLevel: 80,
  operationalThreshold: 20,
  currentPosition: null,
  hasActiveTask: false,
  ...overrides,
});

describe('dispatch.policy', () => {
  describe('isEligible', () => {
    it('accepts a healthy, idle, charged, integrated AGV', () => {
      expect(isEligible(candidate())).toBe(true);
    });

    it.each([
      ['dispatch disabled', { dispatchEnabled: false }],
      ['ignored', { ignored: true }],
      ['not available in FMS', { available: false }],
      ['already has an active task', { hasActiveTask: true }],
      ['battery at threshold', { energyLevel: 20, operationalThreshold: 20 }],
      [
        'battery below threshold',
        { energyLevel: 15, operationalThreshold: 20 },
      ],
    ])('rejects when %s', (_label, overrides) => {
      expect(isEligible(candidate(overrides))).toBe(false);
    });

    it('requires energy strictly above the threshold', () => {
      expect(
        isEligible(candidate({ energyLevel: 21, operationalThreshold: 20 })),
      ).toBe(true);
    });

    it('accepts a vehicle en route to park (preemptible) though not idle', () => {
      expect(
        isEligible(
          candidate({
            available: false,
            preemptibleParking: true,
            parkOrderName: 'PARK-abc',
          }),
        ),
      ).toBe(true);
    });

    it.each([
      ['it already has a task', { hasActiveTask: true }],
      ['its battery is at threshold', { energyLevel: 20 }],
      ['dispatch is disabled', { dispatchEnabled: false }],
    ])('still rejects a preemptible vehicle when %s', (_label, overrides) => {
      expect(
        isEligible(
          candidate({
            available: false,
            preemptibleParking: true,
            parkOrderName: 'PARK-abc',
            operationalThreshold: 20,
            ...overrides,
          }),
        ),
      ).toBe(false);
    });
  });

  describe('pickVehicle', () => {
    it('returns null when no candidate is eligible', () => {
      expect(pickVehicle([candidate({ ignored: true })])).toBeNull();
      expect(pickVehicle([])).toBeNull();
    });

    it('picks the lowest-named eligible vehicle (deterministic)', () => {
      const picked = pickVehicle([
        candidate({ name: 'Vehicle-0003' }),
        candidate({ name: 'Vehicle-0001' }),
        candidate({ name: 'Vehicle-0002' }),
      ]);
      expect(picked?.name).toBe('Vehicle-0001');
    });

    it('skips ineligible vehicles even if they sort first', () => {
      const picked = pickVehicle([
        candidate({ name: 'Vehicle-0001', available: false }),
        candidate({ name: 'Vehicle-0002' }),
      ]);
      expect(picked?.name).toBe('Vehicle-0002');
    });
  });

  describe('pickNearestVehicle', () => {
    it('returns null when no candidate is eligible', () => {
      expect(
        pickNearestVehicle([candidate({ ignored: true })], new Map()),
      ).toBeNull();
      expect(pickNearestVehicle([], new Map())).toBeNull();
    });

    it('picks the eligible vehicle closest to the pickup point', () => {
      const picked = pickNearestVehicle(
        [
          candidate({ name: 'Vehicle-0001', currentPosition: 'P-far' }),
          candidate({ name: 'Vehicle-0002', currentPosition: 'P-near' }),
        ],
        new Map([
          ['P-far', 500],
          ['P-near', 10],
        ]),
      );
      expect(picked?.name).toBe('Vehicle-0002');
    });

    it('ignores distance of ineligible vehicles', () => {
      const picked = pickNearestVehicle(
        [
          candidate({
            name: 'Vehicle-0001',
            currentPosition: 'P-near',
            hasActiveTask: true,
          }),
          candidate({ name: 'Vehicle-0002', currentPosition: 'P-far' }),
        ],
        new Map([
          ['P-near', 10],
          ['P-far', 500],
        ]),
      );
      expect(picked?.name).toBe('Vehicle-0002');
    });

    it('treats unknown/unreachable position as farthest', () => {
      const picked = pickNearestVehicle(
        [
          candidate({ name: 'Vehicle-0001', currentPosition: null }),
          candidate({ name: 'Vehicle-0002', currentPosition: 'P-reachable' }),
        ],
        new Map([['P-reachable', 999]]),
      );
      expect(picked?.name).toBe('Vehicle-0002');
    });

    it('falls back to lowest name on a distance tie', () => {
      const picked = pickNearestVehicle(
        [
          candidate({ name: 'Vehicle-0003', currentPosition: 'P' }),
          candidate({ name: 'Vehicle-0001', currentPosition: 'P' }),
        ],
        new Map([['P', 42]]),
      );
      expect(picked?.name).toBe('Vehicle-0001');
    });
  });

  describe('planVehicleAssignments', () => {
    it('finds the global minimum instead of a per-task greedy minimum', () => {
      const assignments = planVehicleAssignments(
        [
          candidate({ name: 'V1', currentPosition: 'P1' }),
          candidate({ name: 'V2', currentPosition: 'P2' }),
        ],
        [
          {
            taskId: 'T1',
            distanceByPoint: new Map([
              ['P1', 1],
              ['P2', 2],
            ]),
          },
          {
            taskId: 'T2',
            distanceByPoint: new Map([
              ['P1', 2],
              ['P2', 100],
            ]),
          },
        ],
      );

      expect(
        assignments.map(({ taskId, vehicle, distance }) => ({
          taskId,
          vehicle: vehicle.name,
          distance,
        })),
      ).toEqual([
        { taskId: 'T1', vehicle: 'V2', distance: 2 },
        { taskId: 'T2', vehicle: 'V1', distance: 2 },
      ]);
    });

    it('keeps the FIFO head when the backlog is larger than the fleet', () => {
      const assignments = planVehicleAssignments(
        [
          candidate({ name: 'V1', currentPosition: 'P1' }),
          candidate({ name: 'V2', currentPosition: 'P2' }),
        ],
        [
          { taskId: 'oldest', distanceByPoint: new Map([['P1', 100]]) },
          { taskId: 'older', distanceByPoint: new Map([['P2', 100]]) },
          {
            taskId: 'newest-but-nearest',
            distanceByPoint: new Map([
              ['P1', 0],
              ['P2', 0],
            ]),
          },
        ],
      );

      expect(assignments.map((assignment) => assignment.taskId)).toEqual([
        'oldest',
        'older',
      ]);
    });

    it('filters ineligible vehicles before planning', () => {
      const assignments = planVehicleAssignments(
        [
          candidate({ name: 'disabled', dispatchEnabled: false }),
          candidate({ name: 'eligible' }),
        ],
        [{ taskId: 'T1', distanceByPoint: null }],
      );

      expect(assignments).toHaveLength(1);
      expect(assignments[0].vehicle.name).toBe('eligible');
    });

    it('never assigns the same physical vehicle name twice', () => {
      const assignments = planVehicleAssignments(
        [candidate({ name: 'V1' }), candidate({ name: 'V1' })],
        [
          { taskId: 'T1', distanceByPoint: null },
          { taskId: 'T2', distanceByPoint: null },
        ],
      );

      expect(assignments.map((assignment) => assignment.vehicle.name)).toEqual([
        'V1',
      ]);
    });

    it('uses stable task and vehicle order when no distance data is available', () => {
      const assignments = planVehicleAssignments(
        [candidate({ name: 'V2' }), candidate({ name: 'V1' })],
        [
          { taskId: 'T1', distanceByPoint: null },
          { taskId: 'T2', distanceByPoint: new Map() },
        ],
      );

      expect(
        assignments.map(({ taskId, vehicle, distance }) => ({
          taskId,
          vehicle: vehicle.name,
          distance,
        })),
      ).toEqual([
        { taskId: 'T1', vehicle: 'V1', distance: null },
        { taskId: 'T2', vehicle: 'V2', distance: null },
      ]);
    });

    it('prefers a fully reachable matching over a shorter fallback pairing', () => {
      const assignments = planVehicleAssignments(
        [
          candidate({ name: 'V1', currentPosition: 'P1' }),
          candidate({ name: 'V2', currentPosition: 'P2' }),
        ],
        [
          { taskId: 'T1', distanceByPoint: new Map([['P1', 100]]) },
          {
            taskId: 'T2',
            distanceByPoint: new Map([
              ['P1', 0],
              ['P2', 100],
            ]),
          },
        ],
      );

      expect(assignments.map((assignment) => assignment.distance)).toEqual([
        100, 100,
      ]);
    });

    it('does not dispatch a graph-confirmed unreachable pair', () => {
      const assignments = planVehicleAssignments(
        [candidate({ name: 'V1', currentPosition: 'DISCONNECTED' })],
        [{ taskId: 'T1', distanceByPoint: new Map([['OTHER-POINT', 5]]) }],
      );

      expect(assignments).toEqual([]);
    });

    it('battery weight shifts the short trip onto the low-battery vehicle', () => {
      const vehicles = [
        candidate({ name: 'V1', currentPosition: 'P1', energyLevel: 100 }),
        candidate({ name: 'V2', currentPosition: 'P2', energyLevel: 25 }),
      ];
      const tasks = [
        {
          taskId: 'T1',
          distanceByPoint: new Map([
            ['P1', 160],
            ['P2', 100],
          ]),
        },
        {
          taskId: 'T2',
          distanceByPoint: new Map([
            ['P1', 100],
            ['P2', 50],
          ]),
        },
      ];

      const plain = planVehicleAssignments(vehicles, tasks).map(
        ({ taskId, vehicle, distance }) => [taskId, vehicle.name, distance],
      );
      expect(plain).toEqual([
        ['T1', 'V2', 100],
        ['T2', 'V1', 100],
      ]);

      const weighted = planVehicleAssignments(vehicles, tasks, 5).map(
        ({ taskId, vehicle, distance }) => [taskId, vehicle.name, distance],
      );
      expect(weighted).toEqual([
        ['T1', 'V1', 160],
        ['T2', 'V2', 50],
      ]);
    });

    it('battery weight 0 is the exact fast path — cost equals raw distance', () => {
      const vehicles = [
        candidate({ name: 'V1', currentPosition: 'P1', energyLevel: 21 }),
        candidate({ name: 'V2', currentPosition: 'P2', energyLevel: 100 }),
      ];
      const tasks = [
        {
          taskId: 'T1',
          distanceByPoint: new Map([
            ['P1', 10],
            ['P2', 20],
          ]),
        },
      ];
      expect(planVehicleAssignments(vehicles, tasks, 0)).toEqual(
        planVehicleAssignments(vehicles, tasks),
      );
      expect(planVehicleAssignments(vehicles, tasks)[0].vehicle.name).toBe(
        'V1',
      );
    });

    it('battery cost never overturns feasibility — reachable beats unknown', () => {
      const vehicles = [
        candidate({ name: 'V1', currentPosition: null, energyLevel: 100 }),
        candidate({ name: 'V2', currentPosition: 'P', energyLevel: 25 }),
      ];
      const tasks = [
        { taskId: 'T1', distanceByPoint: new Map([['P', 1_000_000]]) },
      ];

      const [assignment] = planVehicleAssignments(vehicles, tasks, 10);
      expect(assignment.vehicle.name).toBe('V2');
      expect(assignment.distance).toBe(1_000_000);
    });

    it('keeps the oldest feasible task when reachable edges conflict', () => {
      const assignments = planVehicleAssignments(
        [
          candidate({ name: 'V1', currentPosition: 'P1' }),
          candidate({ name: 'V2', currentPosition: 'P2' }),
        ],
        [
          { taskId: 'oldest', distanceByPoint: new Map([['P1', 1]]) },
          { taskId: 'newer', distanceByPoint: new Map([['P1', 1]]) },
        ],
      );

      expect(assignments.map((assignment) => assignment.taskId)).toEqual([
        'oldest',
      ]);
    });
  });
});

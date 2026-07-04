import {
  VehicleCandidate,
  isEligible,
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
});

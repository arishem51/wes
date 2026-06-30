import { VehicleCandidate, isEligible, pickVehicle } from './dispatch.policy';

const candidate = (
  overrides: Partial<VehicleCandidate> = {},
): VehicleCandidate => ({
  name: 'Vehicle-0001',
  dispatchEnabled: true,
  ignored: false,
  available: true,
  energyLevel: 80,
  operationalThreshold: 20,
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
      ['battery below threshold', { energyLevel: 15, operationalThreshold: 20 }],
    ])('rejects when %s', (_label, overrides) => {
      expect(isEligible(candidate(overrides))).toBe(false);
    });

    it('requires energy strictly above the threshold', () => {
      expect(isEligible(candidate({ energyLevel: 21, operationalThreshold: 20 }))).toBe(
        true,
      );
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
});

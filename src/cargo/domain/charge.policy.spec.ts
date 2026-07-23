import {
  ChargeLocation,
  ChargeVehicleCandidate,
  needsCharging,
  isReleaseCandidate,
  shouldRelease,
  pickChargeLocation,
} from './charge.policy';

const candidate = (
  overrides: Partial<ChargeVehicleCandidate> = {},
): ChargeVehicleCandidate => ({
  name: 'V1',
  dispatchEnabled: true,
  ignored: false,
  idleAvailable: true,
  charging: false,
  onOrder: false,
  currentPosition: 'P1',
  energyLevel: 15,
  criticalThreshold: 20,
  sufficientThreshold: 60,
  ...overrides,
});

const CHARGE_POINTS = new Set(['C1', 'C2', 'C3']);

describe('charge.policy', () => {
  describe('needsCharging', () => {
    it('is true for an idle, localized AGV at or below critical, off a charge point', () => {
      expect(needsCharging(candidate(), CHARGE_POINTS)).toBe(true);
    });

    it('is true exactly at the critical threshold (<=)', () => {
      expect(needsCharging(candidate({ energyLevel: 20 }), CHARGE_POINTS)).toBe(
        true,
      );
    });

    it('is false above the critical threshold', () => {
      expect(needsCharging(candidate({ energyLevel: 21 }), CHARGE_POINTS)).toBe(
        false,
      );
    });

    it('is false when disabled, ignored, not idle, on an order, or unlocalized', () => {
      expect(
        needsCharging(candidate({ dispatchEnabled: false }), CHARGE_POINTS),
      ).toBe(false);
      expect(needsCharging(candidate({ ignored: true }), CHARGE_POINTS)).toBe(
        false,
      );
      expect(
        needsCharging(candidate({ idleAvailable: false }), CHARGE_POINTS),
      ).toBe(false);
      expect(needsCharging(candidate({ onOrder: true }), CHARGE_POINTS)).toBe(
        false,
      );
      expect(
        needsCharging(candidate({ currentPosition: null }), CHARGE_POINTS),
      ).toBe(false);
    });

    it('is false when already standing on a charge point', () => {
      expect(
        needsCharging(candidate({ currentPosition: 'C2' }), CHARGE_POINTS),
      ).toBe(false);
    });
  });

  describe('isReleaseCandidate', () => {
    it('is true for a charging AGV not on a new order', () => {
      expect(isReleaseCandidate(candidate({ charging: true }))).toBe(true);
    });

    it('is false when not charging or already on an order', () => {
      expect(isReleaseCandidate(candidate({ charging: false }))).toBe(false);
      expect(
        isReleaseCandidate(candidate({ charging: true, onOrder: true })),
      ).toBe(false);
    });
  });

  describe('shouldRelease', () => {
    it('is true at or above the full threshold', () => {
      expect(shouldRelease(candidate({ energyLevel: 85 }), 85)).toBe(true);
      expect(shouldRelease(candidate({ energyLevel: 90 }), 85)).toBe(true);
    });

    it('is false below the full threshold', () => {
      expect(shouldRelease(candidate({ energyLevel: 84 }), 85)).toBe(false);
    });
  });

  describe('pickChargeLocation', () => {
    const locations: ChargeLocation[] = [
      { name: 'Area 1', points: ['C1', 'C2'] },
      { name: 'Area 2', points: ['C3'] },
    ];
    const allFree = new Map([
      ['Area 1', 2],
      ['Area 2', 1],
    ]);

    it('picks the location whose nearest member point is closest', () => {
      const distances = new Map([
        ['C1', 50],
        ['C2', 40],
        ['C3', 30],
      ]);
      expect(pickChargeLocation(locations, distances, allFree)?.name).toBe(
        'Area 2',
      );
    });

    it('uses the minimum over a location member points', () => {
      const distances = new Map([
        ['C1', 10],
        ['C2', 99],
        ['C3', 20],
      ]);
      expect(pickChargeLocation(locations, distances, allFree)?.name).toBe(
        'Area 1',
      );
    });

    it('drops unreachable locations and returns null when none reachable', () => {
      expect(pickChargeLocation(locations, new Map(), allFree)).toBeNull();
    });

    it('breaks ties by location name', () => {
      const distances = new Map([
        ['C1', 30],
        ['C3', 30],
      ]);
      expect(pickChargeLocation(locations, distances, allFree)?.name).toBe(
        'Area 1',
      );
    });

    it('skips a location with no free slot', () => {
      const distances = new Map([
        ['C1', 50],
        ['C2', 40],
        ['C3', 30],
      ]);
      const freeSlots = new Map([
        ['Area 1', 2],
        ['Area 2', 0],
      ]);
      expect(pickChargeLocation(locations, distances, freeSlots)?.name).toBe(
        'Area 1',
      );
    });

    it('returns null when every location is full', () => {
      const distances = new Map([
        ['C1', 30],
        ['C3', 30],
      ]);
      const freeSlots = new Map([
        ['Area 1', 0],
        ['Area 2', 0],
      ]);
      expect(pickChargeLocation(locations, distances, freeSlots)).toBeNull();
    });
  });
});

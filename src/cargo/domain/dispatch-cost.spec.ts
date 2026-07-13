import {
  DEFAULT_AGE_HORIZON_MS,
  WEIGHT_MAX,
  batteryCost,
  clamp01,
  clampWeight,
  positiveOr,
  selectionScore,
} from './dispatch-cost';

describe('dispatch-cost', () => {
  describe('clamp01', () => {
    it.each([
      [0.5, 0.5],
      [0, 0],
      [1, 1],
      [-0.3, 0],
      [1.7, 1],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [Number.NEGATIVE_INFINITY, 0],
    ])('clamps %p to %p', (input, expected) => {
      expect(clamp01(input)).toBe(expected);
    });
  });

  describe('clampWeight', () => {
    it.each([
      [3, 3],
      [0, 0],
      [-1, 0],
      [WEIGHT_MAX + 5, WEIGHT_MAX],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ])('clamps %p to %p', (input, expected) => {
      expect(clampWeight(input)).toBe(expected);
    });
  });

  describe('positiveOr', () => {
    it.each([
      [5, 9, 5],
      [0, 9, 9],
      [-2, 9, 9],
      [Number.NaN, 9, 9],
    ])('positiveOr(%p, %p) = %p', (value, fallback, expected) => {
      expect(positiveOr(value, fallback)).toBe(expected);
    });
  });

  describe('batteryCost', () => {
    it('equals raw distance when the battery weight is 0', () => {
      expect(batteryCost(1234, 15, 0)).toBe(1234);
      expect(batteryCost(1234, 100, 0)).toBe(1234);
    });

    it('equals raw distance for a full battery regardless of weight', () => {
      expect(batteryCost(1000, 100, 5)).toBe(1000);
    });

    it('penalises long trips for low-battery vehicles', () => {
      expect(batteryCost(1000, 0, 1)).toBe(2000);
      expect(batteryCost(1000, 50, 1)).toBe(1500);
      expect(batteryCost(1000, 50, 2)).toBe(2000);
    });

    it('is zero at zero distance — battery never matters when already there', () => {
      expect(batteryCost(0, 1, 10)).toBe(0);
    });

    it('stays finite and non-negative on garbage battery input', () => {
      for (const energy of [Number.NaN, -50, 400, Number.POSITIVE_INFINITY]) {
        const cost = batteryCost(1000, energy, 5);
        expect(Number.isFinite(cost)).toBe(true);
        expect(cost).toBeGreaterThanOrEqual(0);
      }
    });

    it('never lowers the cost below the raw distance', () => {
      for (const energy of [0, 30, 70, 100]) {
        for (const weight of [0, 1, 5, 10]) {
          expect(batteryCost(777, energy, weight)).toBeGreaterThanOrEqual(777);
        }
      }
    });
  });

  describe('selectionScore', () => {
    it('reduces to pure age (FIFO) when the urgency weight is 0', () => {
      const older = selectionScore(120_000, 5, 0);
      const newer = selectionScore(60_000, 5, 0);
      expect(older).toBeGreaterThan(newer);
      expect(selectionScore(60_000, 99, 0)).toBe(selectionScore(60_000, 0, 0));
    });

    it('ranks a lane-blocking task above a same-age non-blocking one', () => {
      const blocking = selectionScore(60_000, 3, 1);
      const plain = selectionScore(60_000, 0, 1);
      expect(blocking).toBeGreaterThan(plain);
    });

    it('caps the blocking contribution at blockMax', () => {
      expect(selectionScore(0, 5, 1, DEFAULT_AGE_HORIZON_MS, 5)).toBe(
        selectionScore(0, 50, 1, DEFAULT_AGE_HORIZON_MS, 5),
      );
    });

    it('lets a sufficiently old task overtake any blocking-heavy newcomer (starvation guard)', () => {
      const maxUrgencyNewcomer = selectionScore(0, 999, WEIGHT_MAX);
      const veryOldPlainTask = selectionScore(
        DEFAULT_AGE_HORIZON_MS * (WEIGHT_MAX + 1),
        0,
        WEIGHT_MAX,
      );
      expect(veryOldPlainTask).toBeGreaterThan(maxUrgencyNewcomer);
    });

    it('falls back to defaults on invalid horizon or blockMax', () => {
      const score = selectionScore(60_000, 2, 1, 0, -1);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBe(selectionScore(60_000, 2, 1));
    });

    it('treats negative or non-finite age as 0', () => {
      expect(selectionScore(-5, 0, 0)).toBe(0);
      expect(selectionScore(Number.NaN, 0, 0)).toBe(0);
    });
  });
});

export const WEIGHT_MAX = 10;
export const DEFAULT_AGE_HORIZON_MS = 600_000;
export const DEFAULT_BLOCK_MAX = 5;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > WEIGHT_MAX) return WEIGHT_MAX;
  return value;
}

export function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function batteryCost(
  distance: number,
  energyLevel: number,
  batteryWeight: number,
): number {
  const lowBatteryShare = 1 - clamp01(energyLevel / 100);
  const cost = distance * (1 + clampWeight(batteryWeight) * lowBatteryShare);
  return Number.isFinite(cost) && cost >= 0 ? cost : distance;
}

export function selectionScore(
  ageMs: number,
  blockingCount: number,
  urgencyWeight: number,
  ageHorizonMs: number = DEFAULT_AGE_HORIZON_MS,
  blockMax: number = DEFAULT_BLOCK_MAX,
): number {
  const horizon = positiveOr(ageHorizonMs, DEFAULT_AGE_HORIZON_MS);
  const maxBlocking = positiveOr(blockMax, DEFAULT_BLOCK_MAX);
  const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
  const normAge = age / horizon;
  const normBlocking = clamp01(blockingCount / maxBlocking);
  return normAge + clampWeight(urgencyWeight) * normBlocking;
}

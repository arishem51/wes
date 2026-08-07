import type { SwapOptions } from './dispatch.policy';

export const DEFAULT_SWAP_BASE_MM = 2_000;
export const DEFAULT_SWAP_STEP_MM = 2_000;
export const DEFAULT_SWAP_MAX = 2;

export type DispatchEnv = Record<string, string | undefined>;

function nonNegative(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function swapOptionsFrom(env: DispatchEnv): SwapOptions {
  return {
    enabled: env.DISPATCH_SWAP === 'on',
    baseMm: nonNegative(env.DISPATCH_SWAP_BASE_MM, DEFAULT_SWAP_BASE_MM),
    stepMm: nonNegative(env.DISPATCH_SWAP_STEP_MM, DEFAULT_SWAP_STEP_MM),
    maxSwaps: nonNegative(env.DISPATCH_SWAP_MAX, DEFAULT_SWAP_MAX),
  };
}

export function describeSwapOptions(swap: SwapOptions): string {
  return swap.enabled
    ? `ON (base ${swap.baseMm}mm, step ${swap.stepMm}mm, max ${swap.maxSwaps})`
    : 'OFF';
}

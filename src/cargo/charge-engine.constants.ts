export const STOP_CHARGING_ACTION = 'stopCharging';
export const DEFAULT_FULL_CHARGE_PCT = 85;
export const TERMINAL_ORDER_STATES: ReadonlySet<string> = new Set([
  'FINISHED',
  'FAILED',
  'UNROUTABLE',
  'WITHDRAWN',
]);

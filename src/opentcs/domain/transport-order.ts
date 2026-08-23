import type { TransportOrderDestination } from './kernel-model';

export const ORDER_KIND = {
  PICKUP: 'PICKUP',
  APPROACH: 'APPROACH',
  DROPOFF: 'DROPOFF',
  PARK: 'PARK',
  CHARGE: 'CHARGE',
} as const;

export type OrderKind = (typeof ORDER_KIND)[keyof typeof ORDER_KIND];

export const ORDER_PROP = {
  TASK_ID: 'wes:taskId',
  LEG: 'wes:leg',
} as const;

export interface IssueTransportOrder {
  readonly kind: OrderKind;
  readonly vehicleName: string;
  readonly aimedAt: string;
  readonly destinations: readonly TransportOrderDestination[];
  readonly taskId?: string;
  readonly dispensable?: boolean;
}

export interface CancelTransportOrder {
  readonly immediate?: boolean;
}

const UUID_SUFFIX_LENGTH = 37;

export function orderNamePrefix(kind: OrderKind): string {
  return `${kind}-`;
}

export function buildOrderName(
  kind: OrderKind,
  vehicleName: string,
  aimedAt: string,
  uuid: string,
): string {
  return `${orderNamePrefix(kind)}${vehicleName}-${aimedAt}-${uuid}`;
}

export function orderProperties(
  kind: OrderKind,
  taskId?: string,
): Record<string, string> {
  const properties: Record<string, string> = { [ORDER_PROP.LEG]: kind };
  if (taskId) properties[ORDER_PROP.TASK_ID] = taskId;
  return properties;
}

export function destinationFromOrderName(
  kind: OrderKind,
  orderName: string | null | undefined,
  vehicleName: string,
): string | null {
  if (!orderName) return null;
  const prefix = `${orderNamePrefix(kind)}${vehicleName}-`;
  if (!orderName.startsWith(prefix)) return null;
  const aimedAt = orderName.slice(
    prefix.length,
    orderName.length - UUID_SUFFIX_LENGTH,
  );
  return aimedAt.length > 0 ? aimedAt : null;
}

export function parkPointFromOrderName(
  orderName: string | null | undefined,
  vehicleName: string,
): string | null {
  return destinationFromOrderName(ORDER_KIND.PARK, orderName, vehicleName);
}

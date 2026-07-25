const UUID_SUFFIX_LENGTH = 37;

export const ORDER_TYPE = {
  PARK: 'PARK',
  CHARGE: 'CHARGE',
  PICKUP: 'PICKUP',
  APPROACH: 'APPROACH',
  DROPOFF: 'DROPOFF',
} as const;

export type OrderType = (typeof ORDER_TYPE)[keyof typeof ORDER_TYPE];

export function buildOrderName(
  type: OrderType,
  vehicleName: string,
  destination: string,
  uuid: string,
): string {
  return `${type}-${vehicleName}-${destination}-${uuid}`;
}

export function destinationFromOrderName(
  type: OrderType,
  orderName: string | null | undefined,
  vehicleName: string,
): string | null {
  if (!orderName) return null;
  const prefix = `${type}-${vehicleName}-`;
  if (!orderName.startsWith(prefix)) return null;
  const destination = orderName.slice(
    prefix.length,
    orderName.length - UUID_SUFFIX_LENGTH,
  );
  return destination.length > 0 ? destination : null;
}

export function parkPointFromOrderName(
  orderName: string | null | undefined,
  vehicleName: string,
): string | null {
  return destinationFromOrderName(ORDER_TYPE.PARK, orderName, vehicleName);
}

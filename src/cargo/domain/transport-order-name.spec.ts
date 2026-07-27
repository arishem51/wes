import {
  ORDER_TYPE,
  buildOrderName,
  destinationFromOrderName,
  parkPointFromOrderName,
} from './transport-order-name';

const UUID = '0d4dd3a5-bfe5-4d90-8893-31ed8d12cae5';

describe('transport order name', () => {
  it('formats every order type as TYPE-vehicle-destination-uuid', () => {
    expect(buildOrderName(ORDER_TYPE.PARK, 'Vehicle-0012', '1012', UUID)).toBe(
      `PARK-Vehicle-0012-1012-${UUID}`,
    );
    expect(
      buildOrderName(ORDER_TYPE.CHARGE, 'Vehicle-0003', 'Charger-A', UUID),
    ).toBe(`CHARGE-Vehicle-0003-Charger-A-${UUID}`);
    expect(
      buildOrderName(ORDER_TYPE.PICKUP, 'Vehicle-0007', 'Feeder-2', UUID),
    ).toBe(`PICKUP-Vehicle-0007-Feeder-2-${UUID}`);
    expect(
      buildOrderName(ORDER_TYPE.APPROACH, 'Vehicle-0011', '0086', UUID),
    ).toBe(`APPROACH-Vehicle-0011-0086-${UUID}`);
    expect(
      buildOrderName(ORDER_TYPE.DROPOFF, 'Vehicle-0009', 'Drop-3', UUID),
    ).toBe(`DROPOFF-Vehicle-0009-Drop-3-${UUID}`);
  });

  it('round-trips the destination for every order type', () => {
    for (const type of Object.values(ORDER_TYPE)) {
      const name = buildOrderName(type, 'Vehicle-0012', 'Dest-9', UUID);

      expect(destinationFromOrderName(type, name, 'Vehicle-0012')).toBe(
        'Dest-9',
      );
    }
  });

  it('round-trips a destination containing hyphens', () => {
    const name = buildOrderName(
      ORDER_TYPE.PARK,
      'Vehicle-0001',
      'PARK-1',
      UUID,
    );

    expect(parkPointFromOrderName(name, 'Vehicle-0001')).toBe('PARK-1');
  });

  it('does not confuse one order type for another', () => {
    const charge = buildOrderName(
      ORDER_TYPE.CHARGE,
      'Vehicle-0012',
      'Charger-A',
      UUID,
    );

    expect(parkPointFromOrderName(charge, 'Vehicle-0012')).toBeNull();
    expect(
      destinationFromOrderName(ORDER_TYPE.CHARGE, charge, 'Vehicle-0012'),
    ).toBe('Charger-A');
  });

  it('returns null for an order belonging to another vehicle', () => {
    const name = buildOrderName(ORDER_TYPE.PARK, 'Vehicle-0012', '1012', UUID);

    expect(parkPointFromOrderName(name, 'Vehicle-0013')).toBeNull();
  });

  it('rejects an order whose vehicle name merely shares a prefix', () => {
    const name = buildOrderName(ORDER_TYPE.PARK, 'Vehicle-00121', '1012', UUID);

    expect(parkPointFromOrderName(name, 'Vehicle-0012')).toBeNull();
  });

  it('misreads a destination only if asked about a vehicle that does not own the order — the engine always passes the owner', () => {
    const name = buildOrderName(ORDER_TYPE.PARK, 'V1-spare', '1012', UUID);

    expect(parkPointFromOrderName(name, 'V1')).toBe('spare-1012');
  });

  it('returns null when the vehicle has no order', () => {
    expect(parkPointFromOrderName(null, 'Vehicle-0012')).toBeNull();
    expect(parkPointFromOrderName(undefined, 'Vehicle-0012')).toBeNull();
  });

  it('returns null for a legacy name with no encoded destination', () => {
    expect(parkPointFromOrderName(`PARK-${UUID}`, 'Vehicle-0012')).toBeNull();
  });
});

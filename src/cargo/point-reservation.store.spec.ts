import { PointReservationStore } from './point-reservation.store';

function build(vehicleState: unknown, orderState: string | null = null) {
  const vehicleStore = { get: jest.fn().mockReturnValue(vehicleState) };
  const kernelApi = {
    getTransportOrderState: jest.fn().mockResolvedValue(orderState),
  };
  const store = new PointReservationStore(
    vehicleStore as never,
    kernelApi as never,
  );
  return { store, kernelApi };
}

describe('PointReservationStore', () => {
  it('tracks a reservation by vehicle and point', () => {
    const { store } = build(undefined);
    store.reserve('V1', 'PARK-1', 'PARK-a');
    expect(store.has('V1')).toBe(true);
    expect([...store.reservedPoints()]).toEqual(['PARK-1']);
    store.clear('V1');
    expect(store.has('V1')).toBe(false);
  });

  it('keeps a live reservation without querying the kernel', async () => {
    const { store, kernelApi } = build({
      transportOrder: 'PARK-a',
      currentPosition: 'P1',
    });
    store.reserve('V1', 'PARK-1', 'PARK-a');

    await store.reconcile();

    expect(store.has('V1')).toBe(true);
    expect(kernelApi.getTransportOrderState).not.toHaveBeenCalled();
  });

  it('keeps a reservation while the SSE snapshot lags but the order is still live', async () => {
    const { store, kernelApi } = build(
      { transportOrder: null, currentPosition: 'P1' },
      'BEING_PROCESSED',
    );
    store.reserve('V1', 'PARK-1', 'PARK-a');

    await store.reconcile();

    expect(store.has('V1')).toBe(true);
    expect(kernelApi.getTransportOrderState).toHaveBeenCalledWith('PARK-a');
  });

  it('drops a reservation once the vehicle has arrived at the point', async () => {
    const { store, kernelApi } = build({
      transportOrder: null,
      currentPosition: 'PARK-1',
    });
    store.reserve('V1', 'PARK-1', 'PARK-a');

    await store.reconcile();

    expect(store.has('V1')).toBe(false);
    expect(kernelApi.getTransportOrderState).not.toHaveBeenCalled();
  });

  it('drops a reservation when the order reached a terminal state', async () => {
    const { store } = build(
      { transportOrder: null, currentPosition: 'P1' },
      'WITHDRAWN',
    );
    store.reserve('V1', 'PARK-1', 'PARK-a');

    await store.reconcile();

    expect(store.has('V1')).toBe(false);
  });

  it('drops a reservation when the order no longer exists', async () => {
    const { store } = build(
      { transportOrder: null, currentPosition: 'P1' },
      null,
    );
    store.reserve('V1', 'PARK-1', 'PARK-a');

    await store.reconcile();

    expect(store.has('V1')).toBe(false);
  });
});

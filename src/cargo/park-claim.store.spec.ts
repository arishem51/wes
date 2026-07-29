import { ParkClaimStore } from './park-claim.store';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type {
  KernelApiService,
  KernelParkOrder,
  KernelVehicleState,
} from '../opentcs/kernel-api.service';

const PARK_ORDER = 'PARK-V1-PARK-1-0d4dd3a5-bfe5-4d90-8893-31ed8d12cae5';
const FOREIGN_ORDER = 'Move-01KY7T2QW4ZP8H3N6VC1RB9DKS';

const vehicle = (
  position: string,
  transportOrder: string | null = null,
): KernelVehicleState => ({
  name: 'V1',
  state: 'IDLE',
  procState: transportOrder ? 'PROCESSING_ORDER' : 'IDLE',
  integrationLevel: 'TO_BE_UTILIZED',
  energyLevel: 100,
  paused: false,
  currentPosition: position,
  transportOrder,
});

const liveParkOrder: KernelParkOrder = {
  name: PARK_ORDER,
  vehicle: 'V1',
  destination: 'PARK-1',
};

function setup() {
  const kernelApi = {
    getLiveParkOrders: jest.fn().mockResolvedValue([]),
    getTransportOrderStateStrict: jest
      .fn()
      .mockResolvedValue('BEING_PROCESSED'),
  };
  const vehicleStore = new VehicleStateStore();
  const store = new ParkClaimStore(
    vehicleStore,
    kernelApi as unknown as KernelApiService,
  );
  return { store, kernelApi, vehicleStore };
}

async function readyStoreWithClaim() {
  const built = setup();
  await built.store.onApplicationBootstrap();
  built.store.claim('V1', 'PARK-1', PARK_ORDER);
  return built;
}

describe('ParkClaimStore', () => {
  it('rebuilds the ledger from the kernel on bootstrap', async () => {
    const { store, kernelApi } = setup();
    kernelApi.getLiveParkOrders.mockResolvedValue([liveParkOrder]);

    await store.onApplicationBootstrap();

    expect(store.isReady()).toBe(true);
    expect(store.get('V1')).toEqual({
      point: 'PARK-1',
      orderName: PARK_ORDER,
    });
    expect(store.claimedVehicles()).toEqual(new Set(['V1']));
    expect(store.claimedPoints()).toEqual(new Set(['PARK-1']));
  });

  it('releases a claim once the vehicle stands on the claimed point', async () => {
    const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('PARK-1'));

    await store.reconcile();

    expect(store.claimedPoints()).toEqual(new Set());
    expect(kernelApi.getTransportOrderStateStrict).not.toHaveBeenCalled();
  });

  it('releases a claim once the vehicle is processing the claimed order', async () => {
    const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('P9', PARK_ORDER));

    await store.reconcile();

    expect(store.claimedVehicles()).toEqual(new Set());
    expect(kernelApi.getTransportOrderStateStrict).not.toHaveBeenCalled();
  });

  it('keeps the claim when the vehicle carries some other order', async () => {
    const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('P9', FOREIGN_ORDER));

    await store.reconcile();

    expect(kernelApi.getTransportOrderStateStrict).toHaveBeenCalledWith(
      PARK_ORDER,
    );
    expect(store.get('V1')).toEqual({
      point: 'PARK-1',
      orderName: PARK_ORDER,
    });
  });

  it.each(['FINISHED', 'FAILED', 'UNROUTABLE'])(
    'releases a claim whose order is %s',
    async (state) => {
      const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
      vehicleStore.set('V1', vehicle('P9', FOREIGN_ORDER));
      kernelApi.getTransportOrderStateStrict.mockResolvedValue(state);

      await store.reconcile();

      expect(store.claimedVehicles()).toEqual(new Set());
    },
  );

  it('keeps a claim whose order is WITHDRAWN — that state is not terminal', async () => {
    const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('P9'));
    kernelApi.getTransportOrderStateStrict.mockResolvedValue('WITHDRAWN');

    await store.reconcile();

    expect(store.claimedVehicles()).toEqual(new Set(['V1']));
  });

  it('releases a claim the kernel no longer knows', async () => {
    const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('P9'));
    kernelApi.getTransportOrderStateStrict.mockResolvedValue(null);

    await store.reconcile();

    expect(store.claimedVehicles()).toEqual(new Set());
  });

  it('keeps the claim when the kernel cannot be reached', async () => {
    const { store, kernelApi, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('P9'));
    kernelApi.getTransportOrderStateStrict.mockRejectedValue(
      new Error('connect ECONNREFUSED'),
    );

    await store.reconcile();

    expect(store.claimedVehicles()).toEqual(new Set(['V1']));
    expect(store.claimedPoints()).toEqual(new Set(['PARK-1']));
  });

  it('keeps a live claim across repeated reconciles', async () => {
    const { store, vehicleStore } = await readyStoreWithClaim();
    vehicleStore.set('V1', vehicle('P9'));

    await store.reconcile();
    await store.reconcile();
    await store.reconcile();

    expect(store.claimedPoints()).toEqual(new Set(['PARK-1']));
  });

  it('stays unready when the bootstrap rehydrate fails', async () => {
    const { store, kernelApi } = setup();
    kernelApi.getLiveParkOrders.mockRejectedValue(new Error('kernel down'));

    await store.onApplicationBootstrap();

    expect(store.isReady()).toBe(false);
    expect(store.claimedPoints()).toEqual(new Set());
  });

  it('retries the rehydrate on every reconcile until it succeeds', async () => {
    const { store, kernelApi } = setup();
    kernelApi.getLiveParkOrders.mockRejectedValue(new Error('kernel down'));
    await store.onApplicationBootstrap();

    await store.reconcile();
    expect(store.isReady()).toBe(false);

    kernelApi.getLiveParkOrders.mockResolvedValue([liveParkOrder]);
    await store.reconcile();

    expect(store.isReady()).toBe(true);
    expect(store.claimedPoints()).toEqual(new Set(['PARK-1']));
  });

  it('drops a claim on release and stops reporting its point', async () => {
    const { store } = await readyStoreWithClaim();

    store.release('V1');

    expect(store.get('V1')).toBeUndefined();
    expect(store.claimedPoints()).toEqual(new Set());
  });
});

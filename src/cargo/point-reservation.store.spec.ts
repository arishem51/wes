import { PointReservationStore } from './point-reservation.store';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';

const ORDER = 'PARK-V1-PARK-1-0d4dd3a5-bfe5-4d90-8893-31ed8d12cae5';

function vehicle(
  overrides: Partial<KernelVehicleState> = {},
): KernelVehicleState {
  return {
    name: 'V1',
    state: 'IDLE',
    procState: 'IDLE',
    integrationLevel: 'TO_BE_UTILIZED',
    energyLevel: 100,
    paused: false,
    currentPosition: 'P1',
    transportOrder: null,
    ...overrides,
  };
}

function build(state?: KernelVehicleState) {
  const vehicleStore = new VehicleStateStore();
  if (state) vehicleStore.set(state.name, state);
  return { store: new PointReservationStore(vehicleStore), vehicleStore };
}

describe('PointReservationStore', () => {
  it('tracks a reservation by vehicle and point', () => {
    const { store } = build();
    store.reserve('V1', 'PARK-1', ORDER);

    expect(store.has('V1')).toBe(true);
    expect([...store.reservedPoints()]).toEqual(['PARK-1']);

    store.clear('V1');
    expect(store.has('V1')).toBe(false);
  });

  it('holds the reservation while the kernel has not handed the order to the vehicle', () => {
    const { store } = build(vehicle({ transportOrder: null }));
    store.reserve('V1', 'PARK-1', ORDER);

    store.reconcile();

    expect(store.has('V1')).toBe(true);
  });

  it('holds the reservation when the vehicle is not in the store yet', () => {
    const { store } = build();
    store.reserve('V1', 'PARK-1', ORDER);

    store.reconcile();

    expect(store.has('V1')).toBe(true);
  });

  it('drops the reservation once the vehicle is processing the order', () => {
    const { store } = build(vehicle({ transportOrder: ORDER }));
    store.reserve('V1', 'PARK-1', ORDER);

    store.reconcile();

    expect(store.has('V1')).toBe(false);
  });

  it('drops the reservation when the vehicle took some other order instead', () => {
    const { store } = build(vehicle({ transportOrder: 'PICKUP-1' }));
    store.reserve('V1', 'PARK-1', ORDER);

    store.reconcile();

    expect(store.has('V1')).toBe(false);
  });
});

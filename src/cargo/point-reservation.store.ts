import { Injectable } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';

interface PointReservation {
  point: string;
  order: string;
  createdAt: number;
}

const TERMINAL_ORDER_STATES = new Set([
  'FINISHED',
  'FAILED',
  'UNROUTABLE',
  'WITHDRAWN',
]);

@Injectable()
export class PointReservationStore {
  private readonly byVehicle = new Map<string, PointReservation>();

  constructor(
    private readonly vehicleStore: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
  ) {}

  reserve(vehicle: string, point: string, order: string): void {
    this.byVehicle.set(vehicle, { point, order, createdAt: Date.now() });
  }

  clear(vehicle: string): void {
    this.byVehicle.delete(vehicle);
  }

  has(vehicle: string): boolean {
    return this.byVehicle.has(vehicle);
  }

  reservedPoints(): Set<string> {
    const points = new Set<string>();
    for (const reservation of this.byVehicle.values()) {
      points.add(reservation.point);
    }
    return points;
  }

  async reconcile(): Promise<void> {
    for (const [vehicle, reservation] of [...this.byVehicle]) {
      if (await this.isStale(vehicle, reservation)) {
        this.byVehicle.delete(vehicle);
      }
    }
  }

  private async isStale(
    vehicle: string,
    reservation: PointReservation,
  ): Promise<boolean> {
    const state = this.vehicleStore.get(vehicle);
    if (state?.currentPosition === reservation.point) return true;
    if (state?.transportOrder === reservation.order) return false;
    const orderState = await this.kernelApi.getTransportOrderState(
      reservation.order,
    );
    return orderState === null || TERMINAL_ORDER_STATES.has(orderState);
  }
}

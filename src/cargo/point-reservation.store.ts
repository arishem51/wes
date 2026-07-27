import { Injectable } from '@nestjs/common';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';

interface PointReservation {
  point: string;
  order: string;
}

@Injectable()
export class PointReservationStore {
  private readonly byVehicle = new Map<string, PointReservation>();

  constructor(private readonly vehicleStore: VehicleStateStore) {}

  reserve(vehicle: string, point: string, order: string): void {
    this.byVehicle.set(vehicle, { point, order });
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

  // TODO: should handle timeout case
  reconcile(): void {
    for (const vehicle of [...this.byVehicle.keys()]) {
      if (this.vehicleStore.get(vehicle)?.transportOrder != null) {
        this.byVehicle.delete(vehicle);
      }
    }
  }
}

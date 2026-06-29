import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import type { KernelVehicleState } from './kernel-api.service';

@Injectable()
export class VehicleStateStore {
  private readonly states = new Map<string, KernelVehicleState>();
  private readonly updates = new Subject<KernelVehicleState>();
  private connected = false;

  setConnected(value: boolean): void {
    this.connected = value;
  }

  isConnected(): boolean {
    return this.connected;
  }

  set(name: string, state: KernelVehicleState): void {
    this.states.set(name, state);
    this.updates.next(state);
  }

  get(name: string): KernelVehicleState | undefined {
    return this.states.get(name);
  }

  getAll(): KernelVehicleState[] {
    return [...this.states.values()];
  }

  get vehicleUpdates(): Observable<KernelVehicleState> {
    return this.updates.asObservable();
  }
}

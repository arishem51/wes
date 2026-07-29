import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelParkOrder } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';

export interface ParkClaim {
  readonly point: string;
  readonly orderName: string;
}

const TERMINAL_PARK_ORDER_STATES: ReadonlySet<string> = new Set([
  'FINISHED',
  'FAILED',
  'UNROUTABLE',
]);

@Injectable()
export class ParkClaimStore implements OnApplicationBootstrap {
  private readonly logger = new Logger(ParkClaimStore.name);
  private readonly claims = new Map<string, ParkClaim>();
  private ready = false;

  constructor(
    private readonly vehicleStore: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.rehydrate();
  }

  claim(vehicle: string, point: string, orderName: string): void {
    this.claims.set(vehicle, { point, orderName });
  }

  release(vehicle: string): void {
    this.claims.delete(vehicle);
  }

  get(vehicle: string): ParkClaim | undefined {
    return this.claims.get(vehicle);
  }

  claimedPoints(): Set<string> {
    return new Set([...this.claims.values()].map((claim) => claim.point));
  }

  claimedVehicles(): Set<string> {
    return new Set(this.claims.keys());
  }

  isReady(): boolean {
    return this.ready;
  }

  async reconcile(): Promise<void> {
    if (!this.ready) {
      await this.rehydrate();
      return;
    }
    for (const [vehicle, claim] of [...this.claims]) {
      if (await this.shouldRelease(vehicle, claim)) this.release(vehicle);
    }
  }

  private async shouldRelease(
    vehicle: string,
    claim: ParkClaim,
  ): Promise<boolean> {
    const state = this.vehicleStore.get(vehicle);
    if (state?.currentPosition === claim.point) return true;
    if (state?.transportOrder === claim.orderName) return true;

    try {
      const orderState = await this.kernelApi.getTransportOrderStateStrict(
        claim.orderName,
      );
      return orderState === null || TERMINAL_PARK_ORDER_STATES.has(orderState);
    } catch (err) {
      this.logger.warn(
        `Cannot confirm ${claim.orderName} — keeping ${vehicle}'s claim on ${claim.point}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async rehydrate(): Promise<void> {
    let live: KernelParkOrder[];
    try {
      live = await this.kernelApi.getLiveParkOrders();
    } catch (err) {
      this.ready = false;
      this.logger.warn(
        `Park claims unreadable — no park order will be created until the kernel answers: ${(err as Error).message}`,
      );
      return;
    }

    this.claims.clear();
    for (const order of live) {
      const superseded = this.claims.get(order.vehicle);
      if (superseded) {
        this.logger.warn(
          `${order.vehicle} has more than one live park order — tracking ${order.name}, dropping ${superseded.orderName}`,
        );
      }
      this.claims.set(order.vehicle, {
        point: order.destination,
        orderName: order.name,
      });
    }
    this.ready = true;
    this.logger.log(
      `Park claims rehydrated: ${this.claims.size} live claim(s)`,
    );
  }
}

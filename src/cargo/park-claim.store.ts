import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelTransportOrder } from '../opentcs/domain/kernel-model';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { parkPointFromOrderName } from './domain/transport-order-name';

export interface ParkClaim {
  readonly point: string;
  readonly orderName: string;
}

interface LiveParkClaim extends ParkClaim {
  readonly vehicle: string;
}

const TERMINAL_PARK_ORDER_STATES: ReadonlySet<string> = new Set([
  'FINISHED',
  'FAILED',
  'UNROUTABLE',
]);

function liveParkClaim(order: KernelTransportOrder): LiveParkClaim | null {
  if (!order.intendedVehicle) return null;
  if (TERMINAL_PARK_ORDER_STATES.has(order.state)) return null;

  const parkPoint = parkPointFromOrderName(order.name, order.intendedVehicle);
  if (!parkPoint) return null;

  return {
    vehicle: order.intendedVehicle,
    point: order.destinations[0] ?? parkPoint,
    orderName: order.name,
  };
}

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
    if (state?.transportOrder === claim.orderName) return false;

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
    let orders: KernelTransportOrder[];
    try {
      orders = await this.kernelApi.getTransportOrders();
    } catch (err) {
      this.ready = false;
      this.logger.warn(
        `Park claims unreadable — no park order will be created until the kernel answers: ${(err as Error).message}`,
      );
      return;
    }

    this.claims.clear();
    for (const order of orders) {
      const claim = liveParkClaim(order);
      if (!claim) continue;

      const superseded = this.claims.get(claim.vehicle);
      if (superseded) {
        this.logger.warn(
          `${claim.vehicle} has more than one live park order — tracking ${claim.orderName}, dropping ${superseded.orderName}`,
        );
      }
      this.claims.set(claim.vehicle, {
        point: claim.point,
        orderName: claim.orderName,
      });
    }
    this.ready = true;
    this.logger.log(
      `Park claims rehydrated: ${this.claims.size} live claim(s)`,
    );
  }
}

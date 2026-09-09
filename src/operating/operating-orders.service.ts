import { Injectable } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { TransportOrderDto } from './dto/operating.dto';

/** How long a vehicle's remaining route point list is reused before re-fetching the order. */
const ROUTE_POINTS_TTL_MS = 1_500;

interface RawOrder {
  name?: string;
  type?: string;
  state?: string;
  processingVehicle?: string | null;
  intendedVehicle?: string | null;
  wrappingSequence?: string | null;
  destinations?: { locationName?: string; operation?: string }[];
  creationTime?: string | null;
  currentDriveOrderIndex?: number;
  currentRouteStepIndex?: number;
  driveOrders?: {
    route?: { steps?: { routeIndex?: number; destinationPoint?: string }[] } | null;
  }[];
}

function toDto(order: RawOrder): TransportOrderDto {
  return {
    name: order.name ?? '',
    type: order.type ?? '',
    state: order.state ?? '',
    processingVehicle: order.processingVehicle ?? null,
    intendedVehicle: order.intendedVehicle ?? null,
    wrappingSequence: order.wrappingSequence ?? null,
    destinations: (order.destinations ?? []).map((destination) => ({
      locationName: destination.locationName ?? '',
      operation: destination.operation ?? '',
    })),
    creationTime: order.creationTime ?? null,
  };
}

/**
 * Read-only view of the kernel's transport orders for the operating screen's "Order" panel and
 * detail dialog, plus the per-vehicle remaining-route point list for the map's route highlight.
 * FE passthrough (ARCHITECTURE.md §5.2b) — no writes.
 */
@Injectable()
export class OperatingOrdersService {
  private readonly routePointsCache = new Map<string, { points: string[]; at: number }>();

  constructor(private readonly kernelApi: KernelApiService) {}

  async list(): Promise<TransportOrderDto[]> {
    const raw = ((await this.kernelApi.getTransportOrdersRaw()) as RawOrder[] | null) ?? [];
    return raw.map(toDto);
  }

  async get(name: string): Promise<unknown> {
    return this.kernelApi.getTransportOrderRaw(name);
  }

  /**
   * Point names still ahead of a vehicle on the given transport order — every drive-order route
   * step past the order's current position. Cached briefly: the vehicle SSE stream fires per
   * kernel event, and without a cache each event would re-hit the kernel for the same order.
   */
  async routeRemainingPoints(orderName: string): Promise<string[]> {
    const cached = this.routePointsCache.get(orderName);
    if (cached && Date.now() - cached.at < ROUTE_POINTS_TTL_MS) return cached.points;

    const order = (await this.kernelApi
      .getTransportOrderRaw(orderName)
      .catch(() => null)) as RawOrder | null;

    const points: string[] = [];
    if (order) {
      const currentDrive = order.currentDriveOrderIndex ?? 0;
      const currentStep = order.currentRouteStepIndex ?? -1;
      (order.driveOrders ?? []).forEach((driveOrder, driveIndex) => {
        if (driveIndex < currentDrive) return;
        for (const step of driveOrder.route?.steps ?? []) {
          if (driveIndex === currentDrive && (step.routeIndex ?? 0) <= currentStep) continue;
          if (step.destinationPoint) points.push(step.destinationPoint);
        }
      });
    }
    this.routePointsCache.set(orderName, { points, at: Date.now() });
    return points;
  }
}

import { Injectable } from '@nestjs/common';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { TransportOrderDto } from './dto/operating.dto';

/** How long a vehicle's remaining route point list is reused before re-fetching the order. */
const ROUTE_POINTS_TTL_MS = 1_500;
/** Order names are one-shot (a fresh UUID/task-derived name per order, never reused), so the
 *  cache only ever grows — bound it so a long-running process doesn't accumulate one entry per
 *  order ever issued. */
const ROUTE_PROGRESS_CACHE_MAX = 500;

interface RawOrder {
  name?: string;
  type?: string;
  state?: string;
  processingVehicle?: string | null;
  intendedVehicle?: string | null;
  wrappingSequence?: string | null;
  destinations?: { locationName?: string; operation?: string }[];
  creationTime?: string | null;
  /** openTCS reports `Instant.MAX` (a far-future sentinel) until an order actually finishes. */
  finishedTime?: string | null;
  currentDriveOrderIndex?: number;
  currentRouteStepIndex?: number;
  driveOrders?: {
    route?: {
      steps?: { routeIndex?: number; destinationPoint?: string }[];
    } | null;
  }[];
}

/** openTCS's sentinel `Instant.MAX` doesn't parse as a JS Date — treat it as "not finished". */
function realInstant(iso: string | null | undefined): string | null {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  return iso;
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
    finishedTime: realInstant(order.finishedTime),
  };
}

/**
 * Read-only view of the kernel's transport orders for the operating screen's "Order" panel and
 * detail dialog, plus the per-vehicle remaining-route point list for the map's route highlight.
 * FE passthrough (ARCHITECTURE.md §5.2b) — no writes.
 */
export interface RouteStep {
  point: string;
  driven: boolean;
}

export interface RouteProgress {
  /** Point names still ahead of the vehicle on this order — for the route highlight. */
  points: string[];
  /** % of the order's total route steps already driven, rounded (0 when the route has no steps). */
  percent: number;
  /** Every route step in order, each flagged as already driven or still ahead. */
  steps: RouteStep[];
}

@Injectable()
export class OperatingOrdersService {
  private readonly routeProgressCache = new Map<string, { value: RouteProgress; at: number }>();
  /** Coalesces concurrent cache-misses for the same order into one kernel call — every vehicle
   *  SSE subscriber calls `routeProgress` independently, so without this an N-subscriber tab
   *  count turns into N kernel reads per event on a cold/expired cache entry. */
  private readonly inFlight = new Map<string, Promise<RouteProgress>>();

  constructor(private readonly kernelApi: KernelApiService) {}

  async list(): Promise<TransportOrderDto[]> {
    const raw =
      ((await this.kernelApi.getTransportOrdersRaw()) as RawOrder[] | null) ??
      [];
    return raw.map(toDto);
  }

  async get(name: string): Promise<unknown> {
    return this.kernelApi.getTransportOrderRaw(name);
  }

  /**
   * Remaining route points plus % complete for a transport order — every drive-order route step
   * is either already driven (counts toward `percent`) or still ahead (added to `points`).
   * Cached briefly: the vehicle SSE stream fires per kernel event, and without a cache each event
   * would re-hit the kernel for the same order.
   */
  async routeProgress(orderName: string): Promise<RouteProgress> {
    const cached = this.routeProgressCache.get(orderName);
    if (cached && Date.now() - cached.at < ROUTE_POINTS_TTL_MS) return cached.value;

    const running = this.inFlight.get(orderName);
    if (running) return running;

    const promise = this.computeRouteProgress(orderName).finally(() => {
      this.inFlight.delete(orderName);
    });
    this.inFlight.set(orderName, promise);
    return promise;
  }

  private async computeRouteProgress(orderName: string): Promise<RouteProgress> {
    const order = (await this.kernelApi
      .getTransportOrderRaw(orderName)
      .catch(() => null)) as RawOrder | null;

    const points: string[] = [];
    const steps: RouteStep[] = [];
    let totalSteps = 0;
    let drivenSteps = 0;
    if (order) {
      const currentDrive = order.currentDriveOrderIndex ?? 0;
      const currentStep = order.currentRouteStepIndex ?? -1;
      (order.driveOrders ?? []).forEach((driveOrder, driveIndex) => {
        const routeSteps = driveOrder.route?.steps ?? [];
        totalSteps += routeSteps.length;
        for (const step of routeSteps) {
          const driven =
            driveIndex < currentDrive ||
            (driveIndex === currentDrive && (step.routeIndex ?? 0) <= currentStep);
          if (driven) {
            drivenSteps += 1;
          } else if (step.destinationPoint) {
            points.push(step.destinationPoint);
          }
          if (step.destinationPoint) {
            steps.push({ point: step.destinationPoint, driven });
          }
        }
      });
    }
    const percent = totalSteps > 0 ? Math.round((drivenSteps / totalSteps) * 100) : 0;
    const value: RouteProgress = { points, percent, steps };
    this.routeProgressCache.set(orderName, { value, at: Date.now() });
    if (this.routeProgressCache.size > ROUTE_PROGRESS_CACHE_MAX) {
      const oldest = this.routeProgressCache.keys().next().value;
      if (oldest !== undefined) this.routeProgressCache.delete(oldest);
    }
    return value;
  }
}

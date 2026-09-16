import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { KernelApiService } from '../../opentcs/kernel-api.service';
import { FMS_EVENTS } from '../../cargo/domain/events';
import type { TransportOrderDto } from '../dto/operating.dto';
import {
  computeRouteProgress,
  toTransportOrderDto,
  type RawOrder,
  type RouteProgress,
  type RouteStep,
} from '../domain/route-progress';

export type { RouteProgress, RouteStep };

/** How long a vehicle's remaining route point list is reused before re-fetching the order. */
const ROUTE_POINTS_TTL_MS = 1_500;
/** Order names are one-shot (a fresh UUID/task-derived name per order, never reused), so the
 *  cache only ever grows — bound it so a long-running process doesn't accumulate one entry per
 *  order ever issued. */
const ROUTE_PROGRESS_CACHE_MAX = 500;

/**
 * Read-only view of the kernel's transport orders for the operating screen's "Order" panel and
 * detail dialog, plus the per-vehicle remaining-route point list for the map's route highlight.
 * FE passthrough (ARCHITECTURE.md §5.2b) — no writes. The route-progress math itself lives in
 * `domain/route-progress.ts`; this service is just the kernel fetch + cache/coalesce around it.
 */
@Injectable()
export class OperatingOrdersService {
  private readonly routeProgressCache = new Map<
    string,
    { value: RouteProgress; at: number }
  >();
  /** Coalesces concurrent cache-misses for the same order into one kernel call — every vehicle
   *  SSE subscriber calls `routeProgress` independently, so without this an N-subscriber tab
   *  count turns into N kernel reads per event on a cold/expired cache entry. */
  private readonly inFlight = new Map<string, Promise<RouteProgress>>();
  private readonly ticks = new Subject<TransportOrderDto>();

  constructor(private readonly kernelApi: KernelApiService) {}

  /** Fires the changed order's DTO whenever a kernel transport order's state actually changes —
   *  lets the operating screen's Order panel patch just that row over SSE instead of the FE
   *  invalidating and re-fetching the whole list on every tick. */
  get changes$(): Observable<TransportOrderDto> {
    return this.ticks.asObservable();
  }

  @OnEvent(FMS_EVENTS.TRANSPORT_ORDER_CHANGED)
  async onOrderChanged(name: string): Promise<void> {
    const raw = (await this.kernelApi
      .getTransportOrderRaw(name)
      .catch(() => null)) as RawOrder | null;
    if (!raw) return;
    this.ticks.next(toTransportOrderDto(raw));
  }

  async list(): Promise<TransportOrderDto[]> {
    const raw =
      ((await this.kernelApi.getTransportOrdersRaw()) as RawOrder[] | null) ??
      [];
    return raw.map(toTransportOrderDto);
  }

  async get(name: string): Promise<unknown> {
    return this.kernelApi.getTransportOrderRaw(name);
  }

  async routeProgress(orderName: string): Promise<RouteProgress> {
    const cached = this.routeProgressCache.get(orderName);
    if (cached && Date.now() - cached.at < ROUTE_POINTS_TTL_MS)
      return cached.value;

    const running = this.inFlight.get(orderName);
    if (running) return running;

    const promise = this.fetchAndComputeRouteProgress(orderName).finally(() => {
      this.inFlight.delete(orderName);
    });
    this.inFlight.set(orderName, promise);
    return promise;
  }

  private async fetchAndComputeRouteProgress(
    orderName: string,
  ): Promise<RouteProgress> {
    const order = (await this.kernelApi
      .getTransportOrderRaw(orderName)
      .catch(() => null)) as RawOrder | null;

    const value = computeRouteProgress(order);
    this.routeProgressCache.set(orderName, { value, at: Date.now() });
    if (this.routeProgressCache.size > ROUTE_PROGRESS_CACHE_MAX) {
      const [oldest] = this.routeProgressCache.keys();
      if (oldest !== undefined) this.routeProgressCache.delete(oldest);
    }
    return value;
  }
}

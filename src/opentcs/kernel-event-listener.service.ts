import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as http from 'http';
import * as https from 'https';
import {
  FMS_EVENTS,
  FmsTransportOrderFinishedEvent,
  FmsVehicleAvailableEvent,
  ORDER_PROP,
  TaskLeg,
} from '../cargo/domain/events';
import { KernelApiService } from './kernel-api.service';
import type { KernelVehicleState } from './kernel-api.service';
import { VehicleStateStore } from './vehicle-state.store';
import { FleetTelemetryService } from './fleet-telemetry.service';

const RETRY_DELAY_MS = 3_000;
const HEARTBEAT_MS = Number(process.env.DISPATCH_HEARTBEAT_MS ?? 5_000);

interface TCSObjectState {
  name: string;
  // state/procState arrive as a plain string over REST but as a nested object
  // ({ state: "IDLE", timestamp }) over SSE — typed unknown, unwrapped below.
  state?: unknown;
  procState?: unknown;
  integrationLevel?: string;
  [key: string]: unknown;
}

interface KernelSsePayload {
  currentObjectState: TCSObjectState;
  previousObjectState?: TCSObjectState;
}

@Injectable()
export class KernelEventListenerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KernelEventListenerService.name);
  private readonly baseUrl: string;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentRequest: http.ClientRequest | null = null;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly vehicleStateStore: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
    private readonly telemetry: FleetTelemetryService,
  ) {
    this.baseUrl = process.env.OPENTCS_KERNEL_URL ?? 'http://localhost:55200';
  }

  onApplicationBootstrap(): void {
    this.connect();
    this.startHeartbeat();
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.currentRequest?.destroy();
  }

  /**
   * Level-triggered backstop for the edge-triggered SSE stream. SSE deltas can be
   * lost — a dropped frame, a hot-reload, a transient network blip — leaving the
   * store stale with no reconnect to re-seed it. A missed "→ IDLE" frame keeps a
   * finished vehicle looking PROCESSING_ORDER, so dispatch never re-considers it
   * and it stalls forever. Every HEARTBEAT_MS we re-pull the authoritative REST
   * snapshot into the store and poke the dispatch cycle, so any drift self-heals
   * within one tick regardless of which SSE events were delivered. SSE stays the
   * low-latency fast path; this is the correctness guarantee.
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.reconcileVehicleStates();
    }, HEARTBEAT_MS);
  }

  private async reconcileVehicleStates(): Promise<void> {
    if (this.destroyed) return;
    const vehicles = await this.kernelApi.getVehicleStates();
    // Empty ⇒ kernel unreachable/erroring: keep the last-known state rather than
    // wiping the store, and skip the dispatch poke this tick.
    if (vehicles.length === 0) return;

    for (const v of vehicles) {
      const existing = this.vehicleStateStore.get(v.name);
      // Kernel snapshot is the source of truth for every dispatch-relevant field;
      // preserve only the SSE-derived observedAt (REST carries no kernel timestamp).
      const next: KernelVehicleState = { ...v };
      if (existing?.observedAt) next.observedAt = existing.observedAt;
      this.vehicleStateStore.set(v.name, next);
    }
    // Null payload = "re-evaluate the fleet" (same signal seedStore uses). The
    // DispatchScheduler debounces this into its normal flush, so an event burst
    // and this heartbeat coalesce into one dispatch cycle.
    this.eventEmitter.emit(FMS_EVENTS.VEHICLE_AVAILABLE, null);
  }

  private connect(): void {
    if (this.destroyed) return;

    const url = new URL('/v1/sse', this.baseUrl);
    url.searchParams.set('/events/transportOrders', 'true');
    url.searchParams.set('/events/vehicles', 'true');
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
        },
      },
      (res) => {
        this.logger.log(`SSE connected — status ${res.statusCode}`);
        this.vehicleStateStore.setConnected(true);
        // Telemetry session brackets this connection; rows observed before the
        // session row lands are buffered and flushed under it.
        void this.telemetry.openSession();
        void this.seedStore();
        res.setEncoding('utf8');

        let buffer = '';

        res.on('data', (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            let eventName = '';
            let dataLine = '';

            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                dataLine += line.slice(6);
              }
            }

            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine) as KernelSsePayload;
              this.route(eventName, payload);
            } catch {
              // ignore malformed SSE frames
            }
          }
        });

        res.on('end', () => {
          this.logger.warn('SSE stream ended — reconnecting');
          this.vehicleStateStore.setConnected(false);
          void this.telemetry.closeSession('stream ended');
          this.scheduleReconnect(RETRY_DELAY_MS);
        });

        res.on('error', () => {
          this.vehicleStateStore.setConnected(false);
          void this.telemetry.closeSession('stream error');
          this.scheduleReconnect(RETRY_DELAY_MS);
        });
      },
    );

    req.on('socket', (socket) => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 10_000);
    });

    req.on('error', (err: Error) => {
      this.logger.warn(`SSE request error: ${err.message} — reconnecting`);
      this.vehicleStateStore.setConnected(false);
      void this.telemetry.closeSession(`request error: ${err.message}`);
      this.scheduleReconnect(RETRY_DELAY_MS);
    });

    req.end();
    this.currentRequest = req;
  }

  private async seedStore(): Promise<void> {
    this.kernelApi.invalidatePlantModelCache();
    const vehicles = await this.kernelApi.getVehicleStates();
    for (const v of vehicles) {
      this.vehicleStateStore.set(v.name, v);
    }
    this.logger.log(`Store seeded with ${vehicles.length} vehicle(s)`);
    this.eventEmitter.emit(FMS_EVENTS.VEHICLE_AVAILABLE, null);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private route(eventName: string, payload: KernelSsePayload): void {
    if (eventName === '/events/transportOrders') {
      this.handleTO(payload);
    } else if (eventName === '/events/vehicles') {
      this.handleVehicle(payload);
    }
  }

  private handleTO(payload: KernelSsePayload): void {
    const current = payload.currentObjectState;
    const name = current?.name;
    const state = current?.state;

    if (!name || state !== 'FINISHED') return;

    this.logger.log(`Transport order "${name}" FINISHED`);

    // Route by the WES leg + task id carried on the order's properties, not by
    // the order name (names are opaque unique tokens). Orders WES did not create
    // (e.g. kernel-issued Move-* / charging orders) lack these props — ignore them.
    const props = this.orderProps(current.properties);
    const taskId = props[ORDER_PROP.TASK_ID];
    const leg = props[ORDER_PROP.LEG];
    if (!taskId || !this.isTaskLeg(leg)) return;

    this.eventEmitter.emit(
      FMS_EVENTS.TRANSPORT_ORDER_FINISHED,
      new FmsTransportOrderFinishedEvent(name, taskId, leg),
    );
  }

  // Over SSE, order `properties` arrive as an object map ({ key: value }) —
  // unlike the array form used when writing an order. Read defensively.
  private orderProps(value: unknown): Record<string, string> {
    if (value === null || typeof value !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === 'string') out[key] = val;
    }
    return out;
  }

  private isTaskLeg(value: string | undefined): value is TaskLeg {
    return value === 'PICKUP' || value === 'APPROACH' || value === 'DROPOFF';
  }

  private handleVehicle(payload: KernelSsePayload): void {
    const raw = payload.currentObjectState;
    if (!raw?.name) return;

    // Over SSE, state/procState arrive as { state|procState: "IDLE", timestamp }
    // (TimestampedVehicleState/ProcState) — unwrap to the enum string.
    const state = this.unwrapEnum(raw.state);
    const procState = this.unwrapEnum(raw.procState);
    // Kernel-side observation time for telemetry: prefer the timestamp inside
    // the wrapped enums; position-only updates carry none → ingest time.
    const observedAt =
      this.unwrapTimestamp(raw.state) ??
      this.unwrapTimestamp(raw.procState) ??
      new Date().toISOString();

    const existing = this.vehicleStateStore.get(raw.name);
    const incoming: KernelVehicleState = {
      ...(existing ?? {
        name: raw.name,
        state: 'UNKNOWN',
        procState: 'UNAVAILABLE',
        integrationLevel: 'TO_BE_IGNORED',
        energyLevel: 0,
        paused: false,
        currentPosition: null,
      }),
      ...(state && { state: state as KernelVehicleState['state'] }),
      ...(procState && {
        procState: procState as KernelVehicleState['procState'],
      }),
      ...(typeof raw.integrationLevel === 'string' && {
        integrationLevel:
          raw.integrationLevel as KernelVehicleState['integrationLevel'],
      }),
      ...(typeof raw.energyLevel === 'number' && {
        energyLevel: raw.energyLevel,
      }),
      ...(typeof raw.paused === 'boolean' && { paused: raw.paused }),
      ...(raw.currentPosition !== undefined && {
        currentPosition:
          typeof raw.currentPosition === 'string' ? raw.currentPosition : null,
      }),
      ...(raw.transportOrder !== undefined && {
        transportOrder:
          typeof raw.transportOrder === 'string' ? raw.transportOrder : null,
      }),
      observedAt,
    };

    const previous = existing;
    this.vehicleStateStore.set(raw.name, incoming);

    const nowAvailable = this.isDispatchAvailable(incoming);
    // Fire on any state change that lands on an available state — not only the
    // not-available→available edge. A vehicle settling AWAITING_ORDER→IDLE
    // (both already "available") would otherwise be missed and a freed vehicle
    // never re-dispatched. procState/integrationLevel only, so plain position
    // updates while idle don't spam the dispatch cycle.
    const stateChanged =
      previous?.procState !== incoming.procState ||
      previous?.integrationLevel !== incoming.integrationLevel;

    if (nowAvailable && stateChanged) {
      this.logger.log(
        `Vehicle "${incoming.name}" available (${previous?.procState ?? 'unknown'} → ${incoming.procState})`,
      );
      this.eventEmitter.emit(
        FMS_EVENTS.VEHICLE_AVAILABLE,
        new FmsVehicleAvailableEvent(incoming.name),
      );
    }
  }

  private isDispatchAvailable(state: KernelVehicleState | undefined): boolean {
    if (!state) return false;
    return (
      (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
      state.integrationLevel === 'TO_BE_UTILIZED'
    );
  }

  /**
   * openTCS serializes enum fields differently per channel: the REST API sends
   * a plain string ("IDLE"), while the SSE event wraps it in a timestamped
   * object ({ state|procState: "IDLE", timestamp }). Accept either form and
   * pull out the enum string (the first non-timestamp string property), so the
   * exact inner key name doesn't matter.
   */
  private unwrapEnum(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'timestamp') continue;
        if (typeof inner === 'string') return inner;
      }
    }
    return undefined;
  }

  /** The timestamp of a wrapped enum ({ state, timestamp }); epoch or ISO. */
  private unwrapTimestamp(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const ts = (value as Record<string, unknown>).timestamp;
    if (typeof ts === 'number') return new Date(ts).toISOString();
    if (typeof ts === 'string') {
      const parsed = new Date(ts);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }
    return undefined;
  }
}

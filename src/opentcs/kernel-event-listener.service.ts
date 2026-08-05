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
  FmsDropOffUnloadedEvent,
  FmsTransportOrderFinishedEvent,
  FmsVehicleAvailableEvent,
  FmsVehicleErrorChangedEvent,
  ORDER_PROP,
  TaskLeg,
  VehicleErrorChangeKind,
} from '../cargo/domain/events';
import { KernelApiService } from './kernel-api.service';
import {
  orientationAngleFromSsePose,
  precisePositionFromSsePose,
  toAllocatedResources,
  toVehicleProperties,
} from './domain/kernel-mappers';
import {
  hasVehicleErrors,
  toVehicleErrors,
  vehicleErrorsEqual,
} from './domain/vehicle-errors';
import type { KernelVehicleState } from './domain/kernel-model';
import { VehicleStateStore } from './vehicle-state.store';
import { FleetTelemetryService } from './fleet-telemetry.service';

const RETRY_DELAY_MS = 3_000;
const HEARTBEAT_MS = Number(process.env.DISPATCH_HEARTBEAT_MS ?? 5_000);

interface TCSObjectState {
  name: string;
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
  private connectionGeneration = 0;
  private connectionActive = false;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stallTimeoutMs: number;
  private readonly lastOrderSignature = new Map<string, string>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly vehicleStateStore: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
    private readonly telemetry: FleetTelemetryService,
  ) {
    this.baseUrl = process.env.OPENTCS_KERNEL_URL ?? 'http://localhost:55200';
    this.stallTimeoutMs = Number(process.env.SSE_STALL_TIMEOUT_MS ?? 60_000);
  }

  onApplicationBootstrap(): void {
    this.connect();
    this.startHeartbeat();
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    this.connectionActive = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.clearStallWatchdog();
    this.currentRequest?.destroy();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.reconcileVehicleStates();
    }, HEARTBEAT_MS);
  }

  private async reconcileVehicleStates(): Promise<void> {
    if (this.destroyed) return;
    const vehicles = await this.kernelApi.getVehicleStates();
    if (vehicles.length === 0) return;

    for (const v of vehicles) {
      const existing = this.vehicleStateStore.get(v.name);
      const next: KernelVehicleState = { ...v };
      if (existing?.observedAt) next.observedAt = existing.observedAt;
      this.vehicleStateStore.set(v.name, next);
      this.emitErrorChange(existing, next);
    }
    this.eventEmitter.emit(FMS_EVENTS.VEHICLE_AVAILABLE, null);
  }

  private emitErrorChange(
    previous: KernelVehicleState | undefined,
    incoming: KernelVehicleState,
  ): void {
    if (vehicleErrorsEqual(previous?.errors, incoming.errors)) return;

    const errors = incoming.errors ?? { fatal: [], warning: [] };
    const kind = this.errorChangeKind(previous, incoming);

    this.logger.warn(
      `${incoming.name} errors ${kind}: fatal=[${errors.fatal.join(', ')}] warning=[${errors.warning.join(', ')}]`,
    );

    this.eventEmitter.emit(
      FMS_EVENTS.VEHICLE_ERROR_CHANGED,
      new FmsVehicleErrorChangedEvent(
        incoming.name,
        kind,
        errors.fatal,
        errors.warning,
        incoming.state,
        incoming.currentPosition,
        incoming.transportOrder ?? null,
        incoming.observedAt ?? null,
      ),
    );
  }

  private errorChangeKind(
    previous: KernelVehicleState | undefined,
    incoming: KernelVehicleState,
  ): VehicleErrorChangeKind {
    if (!hasVehicleErrors(incoming.errors)) return 'CLEARED';
    return hasVehicleErrors(previous?.errors) ? 'CHANGED' : 'RAISED';
  }

  private connect(): void {
    if (this.destroyed) return;

    const generation = ++this.connectionGeneration;
    const isCurrentConnection = (): boolean =>
      !this.destroyed && generation === this.connectionGeneration;
    this.clearStallWatchdog();
    const supersededRequest = this.currentRequest;
    this.currentRequest = null;
    supersededRequest?.destroy();

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
        if (!isCurrentConnection()) {
          res.destroy();
          return;
        }
        this.logger.log(`SSE connected — status ${res.statusCode}`);
        this.vehicleStateStore.setConnected(true);
        void this.telemetry.openSession();
        void this.seedStore();
        res.setEncoding('utf8');

        const rearmStallWatchdog = (): void => {
          if (!isCurrentConnection() || this.stallTimeoutMs <= 0) return;
          this.clearStallWatchdog();
          this.stallTimer = setTimeout(() => {
            if (!isCurrentConnection()) return;
            this.logger.warn(
              `SSE stalled — no frame for ${this.stallTimeoutMs} ms — reconnecting`,
            );
            this.currentRequest?.destroy();
            this.handleDisconnect('stream stalled');
          }, this.stallTimeoutMs);
        };
        rearmStallWatchdog();

        let buffer = '';

        res.on('data', (chunk: string) => {
          if (!isCurrentConnection()) return;
          rearmStallWatchdog();
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
          if (!isCurrentConnection()) return;
          this.logger.warn('SSE stream ended — reconnecting');
          this.handleDisconnect('stream ended');
        });

        res.on('error', () => {
          if (!isCurrentConnection()) return;
          this.handleDisconnect('stream error');
        });

        res.on('close', () => {
          if (!isCurrentConnection()) return;
          this.handleDisconnect('stream closed');
        });
      },
    );

    req.on('socket', (socket) => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 10_000);
    });

    req.on('error', (err: Error) => {
      if (!isCurrentConnection()) return;
      this.logger.warn(`SSE request error: ${err.message} — reconnecting`);
      this.handleDisconnect(`request error: ${err.message}`);
    });

    req.end();
    this.currentRequest = req;
    this.connectionActive = true;
  }

  private async seedStore(): Promise<void> {
    this.kernelApi.invalidatePlantModelCache();
    const vehicles = await this.kernelApi.getVehicleStates();
    for (const v of vehicles) {
      const existing = this.vehicleStateStore.get(v.name);
      this.vehicleStateStore.set(v.name, v);
      this.emitErrorChange(existing, v);
    }
    this.logger.log(`Store seeded with ${vehicles.length} vehicle(s)`);
    this.eventEmitter.emit(FMS_EVENTS.VEHICLE_AVAILABLE, null);
  }

  private clearStallWatchdog(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private handleDisconnect(reason: string): void {
    if (!this.connectionActive) return;
    this.connectionActive = false;
    this.clearStallWatchdog();
    this.vehicleStateStore.setConnected(false);
    void this.telemetry.closeSession(reason);
    this.scheduleReconnect(RETRY_DELAY_MS);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.destroyed || this.reconnectTimer || this.connectionActive) return;
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
    if (!name) return;

    const seen = this.lastOrderSignature.get(name);
    const orderState = this.unwrapEnum(current.state) ?? '';
    const driveOrders = this.driveOrderStates(current);
    const signature = `${orderState}|${driveOrders.join(',')}`;
    if (seen === signature) return;
    this.lastOrderSignature.set(name, signature);

    const orderFinished = orderState === 'FINISHED';
    if (orderFinished) this.logger.log(`Transport order "${name}" FINISHED`);

    const props = this.orderProps(current.properties);
    const taskId = props[ORDER_PROP.TASK_ID];
    const leg = props[ORDER_PROP.LEG];
    if (!taskId || !this.isTaskLeg(leg)) return;

    if (orderFinished) {
      this.eventEmitter.emit(
        FMS_EVENTS.TRANSPORT_ORDER_FINISHED,
        new FmsTransportOrderFinishedEvent(name, taskId, leg),
      );
      return;
    }

    if (leg === 'DROPOFF' && this.dropOffJustUnloaded(driveOrders, seen)) {
      this.logger.log(
        `Transport order "${name}" unloaded — retreat leg starting`,
      );
      this.eventEmitter.emit(
        FMS_EVENTS.DROPOFF_UNLOADED,
        new FmsDropOffUnloadedEvent(name, taskId),
      );
    }
  }

  private dropOffJustUnloaded(
    driveOrders: string[],
    seenSignature: string | undefined,
  ): boolean {
    const hasRetreatLegs = driveOrders.length > 1;
    const firstLegFinished = driveOrders[0] === 'FINISHED';
    const seenDriveOrders = seenSignature?.split('|')[1]?.split(',') ?? [];
    return (
      hasRetreatLegs && firstLegFinished && seenDriveOrders[0] !== 'FINISHED'
    );
  }

  private driveOrderStates(state: TCSObjectState | undefined): string[] {
    const raw = state?.driveOrders;
    if (!Array.isArray(raw)) return [];
    return raw.map((order) =>
      order && typeof order === 'object'
        ? (this.unwrapEnum((order as Record<string, unknown>).state) ?? '')
        : '',
    );
  }

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

    const state = this.unwrapEnum(raw.state);
    const procState = this.unwrapEnum(raw.procState);
    const observedAt =
      this.unwrapTimestamp(raw.state) ??
      this.unwrapTimestamp(raw.procState) ??
      new Date().toISOString();

    const existing = this.vehicleStateStore.get(raw.name);
    const properties =
      raw.properties !== undefined
        ? toVehicleProperties(raw.properties)
        : undefined;
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
      ...(raw.pose !== undefined && {
        orientationAngle: orientationAngleFromSsePose(raw.pose),
        precisePosition: precisePositionFromSsePose(raw.pose),
      }),
      ...(raw.allocatedResources !== undefined && {
        allocatedResources: toAllocatedResources(raw.allocatedResources),
      }),
      ...(raw.transportOrder !== undefined && {
        transportOrder:
          typeof raw.transportOrder === 'string' ? raw.transportOrder : null,
      }),
      ...(properties !== undefined && {
        properties,
        errors: toVehicleErrors(properties),
      }),
      observedAt,
    };

    const previous = existing;
    this.vehicleStateStore.set(raw.name, incoming);
    this.emitErrorChange(previous, incoming);

    const nowAvailable = this.isDispatchAvailable(incoming);
    const stateChanged =
      previous?.procState !== incoming.procState ||
      previous?.integrationLevel !== incoming.integrationLevel;

    if (nowAvailable && stateChanged) {
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

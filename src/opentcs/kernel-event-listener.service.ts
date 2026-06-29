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
} from '../cargo/domain/events';
import { KernelApiService } from './kernel-api.service';
import type { KernelVehicleState } from './kernel-api.service';
import { VehicleStateStore } from './vehicle-state.store';

const RETRY_DELAY_MS = 3_000;

interface TCSObjectState {
  name: string;
  state?: string;
  procState?: string;
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
  private currentRequest: http.ClientRequest | null = null;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly vehicleStateStore: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
  ) {
    this.baseUrl = process.env.OPENTCS_KERNEL_URL ?? 'http://localhost:55200';
  }

  onApplicationBootstrap(): void {
    this.connect();
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.currentRequest?.destroy();
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
          this.scheduleReconnect(RETRY_DELAY_MS);
        });

        res.on('error', () => {
          this.vehicleStateStore.setConnected(false);
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
    this.eventEmitter.emit(
      FMS_EVENTS.TRANSPORT_ORDER_FINISHED,
      new FmsTransportOrderFinishedEvent(name),
    );
  }

  private handleVehicle(payload: KernelSsePayload): void {
    const raw = payload.currentObjectState;
    if (!raw?.name) return;

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
      ...(raw.state && { state: raw.state as KernelVehicleState['state'] }),
      ...(raw.procState && {
        procState: raw.procState as KernelVehicleState['procState'],
      }),
      ...(raw.integrationLevel && {
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
    };

    const previous = existing;
    this.vehicleStateStore.set(raw.name, incoming);

    const wasAvailable = this.isDispatchAvailable(previous);
    const nowAvailable = this.isDispatchAvailable(incoming);

    if (!wasAvailable && nowAvailable) {
      this.logger.log(`Vehicle "${incoming.name}" available`);
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
}

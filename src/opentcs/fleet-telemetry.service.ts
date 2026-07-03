import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from 'rxjs';
import type { KernelVehicleState } from './kernel-api.service';
import { SseSessionEntity } from './entities/sse-session.entity';
import { VehicleStateTransitionEntity } from './entities/vehicle-state-transition.entity';
import { VehicleStateStore } from './vehicle-state.store';

/** Batch window: keeps the log write path off the SSE handler's latency. */
const FLUSH_INTERVAL_MS = 1_500;

interface VehicleSnapshot {
  point: string | null;
  procState: string;
  state: string;
  order: string | null;
}

type PendingRow = Omit<VehicleStateTransitionEntity, 'id' | 'sessionId'>;

/**
 * Evaluation telemetry: records every observed change of a vehicle's
 * (position, procState, state, transport order) into
 * vehicle_state_transitions, and brackets them with sse_sessions rows so
 * analysis never computes an interval across an SSE reconnect gap.
 *
 * Pure observer — subscribes to VehicleStateStore updates and never feeds
 * anything back into dispatch. Write failures are logged and dropped; losing
 * telemetry must never stall the fleet.
 */
@Injectable()
export class FleetTelemetryService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(FleetTelemetryService.name);

  private sessionId: string | null = null;
  private readonly last = new Map<string, VehicleSnapshot>();
  private buffer: PendingRow[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private subscription: Subscription | null = null;
  private flushing = false;

  constructor(
    @InjectRepository(SseSessionEntity)
    private readonly sessionRepo: Repository<SseSessionEntity>,
    @InjectRepository(VehicleStateTransitionEntity)
    private readonly transitionRepo: Repository<VehicleStateTransitionEntity>,
    private readonly vehicleStore: VehicleStateStore,
  ) {}

  onModuleInit(): void {
    this.subscription = this.vehicleStore.vehicleUpdates.subscribe((state) =>
      this.record(state),
    );
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.subscription?.unsubscribe();
    await this.closeSession('app shutdown');
  }

  /** Called by KernelEventListenerService on every successful SSE connect. */
  async openSession(): Promise<void> {
    // A dangling session means the previous close never ran (shouldn't happen,
    // but a reconnect must not attribute new rows to the old session).
    await this.closeSession('superseded by new connection');
    try {
      const session = await this.sessionRepo.save(this.sessionRepo.create({}));
      this.sessionId = String(session.id);
      // Force a full per-vehicle snapshot after the observation gap: the next
      // update of every vehicle differs from "nothing" and writes a row.
      this.last.clear();
      this.logger.log(`SSE session ${this.sessionId} opened`);
    } catch (err) {
      this.logger.error(
        `Failed to open SSE session: ${(err as Error).message}`,
      );
    }
  }

  /** Called on SSE disconnect/shutdown. No-op when no session is open. */
  async closeSession(reason: string): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    this.sessionId = null;
    // Rows observed during the closing session must land under its id.
    await this.flush(id);
    try {
      await this.sessionRepo.update(id, {
        endedAt: new Date(),
        endReason: reason.slice(0, 100),
      });
      this.logger.log(`SSE session ${id} closed (${reason})`);
    } catch (err) {
      this.logger.error(
        `Failed to close SSE session ${id}: ${(err as Error).message}`,
      );
    }
  }

  private record(state: KernelVehicleState): void {
    const snapshot: VehicleSnapshot = {
      point: state.currentPosition ?? null,
      procState: state.procState,
      state: state.state,
      order: state.transportOrder ?? null,
    };
    const previous = this.last.get(state.name);
    if (
      previous &&
      previous.point === snapshot.point &&
      previous.procState === snapshot.procState &&
      previous.state === snapshot.state &&
      previous.order === snapshot.order
    ) {
      return; // SSE re-sent an unchanged state — not a transition.
    }
    this.last.set(state.name, snapshot);
    this.buffer.push({
      vehicleName: state.name,
      pointName: snapshot.point,
      procState: snapshot.procState,
      vehicleState: snapshot.state,
      orderName: snapshot.order,
      occurredAt: state.observedAt ? new Date(state.observedAt) : new Date(),
    });
  }

  private async flush(
    sessionId: string | null = this.sessionId,
  ): Promise<void> {
    if (!sessionId || this.buffer.length === 0 || this.flushing) return;
    this.flushing = true;
    const rows = this.buffer;
    this.buffer = [];
    try {
      await this.transitionRepo.insert(
        rows.map((row) => ({ ...row, sessionId })),
      );
    } catch (err) {
      this.logger.error(
        `Failed to flush ${rows.length} vehicle transition(s): ${(err as Error).message}`,
      );
    } finally {
      this.flushing = false;
    }
  }
}

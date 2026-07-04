import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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

// occurred_at is omitted here — it's stamped by Postgres now() at flush time
// (see flush), so every table shares one clock and window cuts never drift.
type PendingRow = Omit<
  VehicleStateTransitionEntity,
  'id' | 'sessionId' | 'occurredAt'
>;

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
    // The in-memory close above can only reach this process's own session; a
    // previous process that exited non-gracefully (crash, start:dev reload)
    // leaves its session row open forever. A fresh connect owns no live
    // session, so any still-open row is orphaned — reap them all before
    // opening the new one (must run before the create below, or it closes it).
    await this.reapOrphanedSessions();
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

  /**
   * Close any sse_sessions left open by a prior process that never got to run
   * closeSession (crash / dev reload). Their exact end time is unknown, so we
   * stamp now(); analysis partitions by session_id regardless.
   */
  private async reapOrphanedSessions(): Promise<void> {
    try {
      await this.sessionRepo.update(
        { endedAt: IsNull() },
        { endedAt: new Date(), endReason: 'orphaned (process exit)' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to reap orphaned SSE sessions: ${(err as Error).message}`,
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
      // occurred_at is set by Postgres now() at flush — the host (Node) clock
      // and the Postgres/Docker clock drift by minutes here, so authoring it in
      // Node would put telemetry in a different frame than runs. The kernel's
      // own SSE timestamp is kept in observed_at for skew diagnostics only.
      observedAt: state.observedAt ? new Date(state.observedAt) : null,
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
        rows.map((row) => ({ ...row, sessionId, occurredAt: () => 'now()' })),
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

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LegReconcileService } from './leg-reconcile.service';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';
import { ParkingEngineService } from './parking-engine.service';
import { FMS_EVENTS, TRANSPORT_TASK_EVENTS } from './domain/events';

const DEBOUNCE_MS = 1_500;

@Injectable()
export class DispatchSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DispatchSchedulerService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Single-flight guard: only one flush cycle runs at a time. Its steps
  // (leg-reconcile → release → assign → park) read a DB/telemetry snapshot then
  // write; two overlapping cycles would double-assign or double-park.
  private isFlushing = false;
  private rerunWanted = false;

  constructor(
    private readonly legReconcile: LegReconcileService,
    private readonly releaseEngine: ReleaseEngineService,
    private readonly assignmentEngine: AssignmentEngineService,
    private readonly parkingEngine: ParkingEngineService,
  ) {}

  // Triggers are debounced in memory, so a restart drops any pending flush.
  // Reconcile once on startup so tasks left in CREATED/BLOCKED (and any
  // assignable READY_TO_ASSIGN) are re-evaluated rather than stranded.
  onApplicationBootstrap(): void {
    this.schedule();
  }

  // Re-run the dispatch cycle whenever there is new work, a task changed
  // state, or a vehicle freed up. All triggers are debounced into one flush.
  // Separate decorators (not the array form) so each event registers as its
  // own listener — the array form did not deliver events here.
  @OnEvent(TRANSPORT_TASK_EVENTS.CREATED)
  @OnEvent(TRANSPORT_TASK_EVENTS.STATUS_CHANGED)
  @OnEvent(FMS_EVENTS.VEHICLE_AVAILABLE)
  onDispatchTrigger(event: unknown): void {
    this.logger.debug(
      `Dispatch trigger: ${(event as { constructor?: { name?: string } })?.constructor?.name ?? typeof event}`,
    );
    this.schedule();
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  // A throw here must never be swallowed: an unlogged flush failure silently
  // stalls the whole dispatch cycle (tasks sit in CREATED forever).
  private async flush(): Promise<void> {
    // A trigger arriving mid-flush must not start a second concurrent cycle;
    // remember it and re-run once this one finishes, so no work is dropped.
    if (this.isFlushing) {
      this.rerunWanted = true;
      return;
    }
    this.isFlushing = true;
    try {
      // Heal any lost "TO FINISHED" first so completed legs advance (and free
      // vehicles) before release/assign/park decide on this cycle.
      await this.legReconcile.run();
      await this.releaseEngine.run();
      await this.assignmentEngine.run();
      await this.parkingEngine.run();
    } catch (err) {
      this.logger.error(
        `Flush failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.isFlushing = false;
      if (this.rerunWanted) {
        this.rerunWanted = false;
        this.schedule();
      }
    }
  }
}

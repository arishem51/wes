import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';
import { FMS_EVENTS, TRANSPORT_TASK_EVENTS } from './domain/events';

const DEBOUNCE_MS = 1_500;

@Injectable()
export class DispatchSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DispatchSchedulerService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly releaseEngine: ReleaseEngineService,
    private readonly assignmentEngine: AssignmentEngineService,
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
    try {
      await this.releaseEngine.run();
      await this.assignmentEngine.run();
    } catch (err) {
      this.logger.error(
        `Flush failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}

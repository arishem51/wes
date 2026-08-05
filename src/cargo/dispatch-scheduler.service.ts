import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LegReconcileService } from './leg-reconcile.service';
import { ReleaseEngineService } from './release-engine.service';
import { AssignmentEngineService } from './assignment-engine.service';
import { ChargeEngineService } from './charge-engine.service';
import { ParkingEngineService } from './parking-engine.service';
import { ParkClaimStore } from './park-claim.store';
import { FMS_EVENTS, TRANSPORT_TASK_EVENTS } from './domain/events';

const DEBOUNCE_MS = 1_500;
const MAX_WAIT_MS = 3_500;

@Injectable()
export class DispatchSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DispatchSchedulerService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private burstStartedAt: number | null = null;
  private isFlushing = false;
  private rerunWanted = false;

  constructor(
    private readonly legReconcile: LegReconcileService,
    private readonly releaseEngine: ReleaseEngineService,
    private readonly assignmentEngine: AssignmentEngineService,
    private readonly chargeEngine: ChargeEngineService,
    private readonly parkingEngine: ParkingEngineService,
    private readonly parkClaims: ParkClaimStore,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule();
  }

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
    const now = Date.now();
    this.burstStartedAt ??= now;
    const remainingBudget = MAX_WAIT_MS - (now - this.burstStartedAt);
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, remainingBudget));

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.burstStartedAt = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.isFlushing) {
      this.rerunWanted = true;
      return;
    }
    this.isFlushing = true;
    try {
      await this.parkClaims.reconcile();
      await this.legReconcile.run();
      await this.releaseEngine.run();
      await this.assignmentEngine.run();
      await this.chargeEngine.run();
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

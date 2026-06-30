import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { PickupDependencyService } from './pickup-dependency.service';

/**
 * Decides which transport tasks may proceed toward assignment, enforcing the
 * pickup row-dependency rule (WF-02 / ARCHITECTURE §6.3): a cargo behind an
 * un-picked cargo in the same lane must wait.
 *
 * Re-evaluates every task whose cargo is still at its source point
 * ({CREATED, READY_TO_ASSIGN, BLOCKED, PICKING_UP}) so a newly added outer
 * cargo can demote — or preempt — an inner one, and a freed lane re-releases
 * whatever was blocked.
 */
@Injectable()
export class ReleaseEngineService {
  private readonly logger = new Logger(ReleaseEngineService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    private readonly transportTask: TransportTaskService,
    private readonly kernelApi: KernelApiService,
    private readonly pickupDependency: PickupDependencyService,
  ) {}

  async run(): Promise<void> {
    const decisions = await this.pickupDependency.evaluate();
    this.logger.debug(
      `ReleaseEngine: ${decisions.length} at-source task(s) → ` +
        decisions
          .map(
            (d) =>
              `${d.task.id.slice(0, 8)}:${d.task.status}:${d.blocked ? 'BLOCKED' : 'OK'}`,
          )
          .join(', '),
    );
    for (const { task, blocked, reason } of decisions) {
      if (blocked) {
        await this.block(task, reason);
      } else {
        await this.unblock(task);
      }
    }
  }

  private async block(
    task: TransportTaskEntity,
    reason: string | null,
  ): Promise<void> {
    switch (task.status) {
      case TaskStatus.CREATED:
      case TaskStatus.READY_TO_ASSIGN:
        task.metadata = {
          ...task.metadata,
          blockedReason: reason ?? undefined,
        };
        await this.transportTask.changeStatus(task, TaskStatus.BLOCKED);
        this.logger.log(`Task ${task.id} → BLOCKED (${reason})`);
        break;
      case TaskStatus.PICKING_UP:
        await this.preempt(task, reason);
        break;
      case TaskStatus.BLOCKED:
        // Already blocked; refresh the reason only if it changed (avoids a
        // redundant write — and a needless event — on every dispatch trigger).
        if ((task.metadata?.blockedReason ?? null) !== (reason ?? null)) {
          task.metadata = {
            ...task.metadata,
            blockedReason: reason ?? undefined,
          };
          await this.taskRepo.save(task);
        }
        break;
      default:
        break;
    }
  }

  private async unblock(task: TransportTaskEntity): Promise<void> {
    // Only tasks still waiting to be released are promoted; in-flight ones
    // (READY_TO_ASSIGN already picked up by assignment, PICKING_UP) are left.
    if (
      task.status !== TaskStatus.CREATED &&
      task.status !== TaskStatus.BLOCKED
    ) {
      return;
    }
    if (task.metadata?.blockedReason) {
      task.metadata = { ...task.metadata, blockedReason: undefined };
    }
    await this.transportTask.changeStatus(task, TaskStatus.READY_TO_ASSIGN);
  }

  /**
   * An outer same-lane cargo appeared while this task was already being
   * picked. Withdraw its pickup order gracefully (openTCS brings the vehicle
   * to a safe halt — immediate=false) and re-block it; it re-releases once the
   * outer cargo leaves its source point.
   */
  private async preempt(
    task: TransportTaskEntity,
    reason: string | null,
  ): Promise<void> {
    const to1Name = task.metadata?.to1Name;
    if (to1Name) {
      try {
        await this.kernelApi.withdrawTransportOrder(to1Name, false);
      } catch (err) {
        this.logger.error(
          `Preempt: failed to withdraw ${to1Name} for task ${task.id}: ${(err as Error).message}`,
        );
      }
    }

    task.metadata = {
      ...task.metadata,
      blockedReason: reason ?? undefined,
      to1Name: undefined,
      assignedVehicleName: undefined,
    };
    task.assignedAt = null;
    task.startedAt = null;
    await this.transportTask.changeStatus(task, TaskStatus.BLOCKED);
    this.logger.log(`Task ${task.id} PREEMPTED → BLOCKED (${reason})`);
  }
}

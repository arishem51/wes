import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { PickupDependencyService } from './pickup-dependency.service';
import { DispatchPolicyService } from './dispatch-policy.service';
import {
  DispatchDistanceService,
  type DispatchDistances,
} from './dispatch-distance.service';
import { VehicleCandidateService } from './vehicle-candidate.service';
import { PickupOrderService } from './pickup-order.service';
import {
  type DispatchMatcher,
  type DispatchTaskCandidate,
  type VehicleCandidate,
  hasDispatchableVehicle,
  isEligible,
  planVehicleAssignments,
  planVehicleAssignmentsGreedy,
} from './domain/dispatch.policy';
import {
  comparableCounterfactual,
  summariseDistance,
} from './domain/dispatch-counterfactual';
import type { DispatchContext, PlannedAction } from './assignment-engine.types';

const BUSY_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

@Injectable()
export class AssignmentEngineService {
  private readonly logger = new Logger(AssignmentEngineService.name);

  private readonly matcher: DispatchMatcher;

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    private readonly pickupDependency: PickupDependencyService,
    private readonly dispatchPolicy: DispatchPolicyService,
    private readonly distanceSource: DispatchDistanceService,
    private readonly vehicleCandidates: VehicleCandidateService,
    private readonly pickupOrders: PickupOrderService,
  ) {
    const requested = process.env.DISPATCH_MATCHER;
    this.matcher = requested === 'greedy' ? 'greedy' : 'hungarian';

    if (requested && requested !== 'greedy' && requested !== 'hungarian') {
      this.logger.warn(
        `DISPATCH_MATCHER="${requested}" is not a known matcher — falling back to hungarian`,
      );
    }
    this.logger.log(
      `Dispatch matcher: ${this.matcher.toUpperCase()} ` +
        `(counterfactual ${this.counterfactualMatcher().toUpperCase()} recorded on every assignment)`,
    );
  }

  private counterfactualMatcher(): DispatchMatcher {
    return this.matcher === 'greedy' ? 'hungarian' : 'greedy';
  }

  async run(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.READY_TO_ASSIGN },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (tasks.length === 0) return;

    const busyTasks = await this.busyTasksByVehicle();
    const weights = await this.dispatchPolicy.getActiveWeights();
    const distances = await this.distanceSource.open();
    const candidates = await this.vehicleCandidates.build(busyTasks);
    this.logCandidates(tasks.length, candidates);

    const quarantinedVehicleNames = new Set<string>();
    const dispatchCandidates = (): VehicleCandidate[] =>
      candidates.filter(
        (candidate) => !quarantinedVehicleNames.has(candidate.name),
      );
    const freeVehicleCount = (): number =>
      new Set(
        dispatchCandidates()
          .filter(isEligible)
          .map((candidate) => candidate.name),
      ).size;
    if (freeVehicleCount() === 0) return;

    const pendingTasks: DispatchContext[] = [];
    let taskCursor = 0;

    const fillPendingTasks = async (): Promise<void> => {
      const capacity = freeVehicleCount();
      while (pendingTasks.length < capacity && taskCursor < tasks.length) {
        const task = tasks[taskCursor++];

        if (await this.pickupDependency.isBlocked(task)) {
          this.logger.debug(
            `Task ${task.id} blocked at assign time — skipping`,
          );
          continue;
        }

        const context = await this.buildContext(task, distances);
        if (context) pendingTasks.push(context);
      }
    };

    const removePendingTask = (taskId: string): void => {
      const index = pendingTasks.findIndex(
        (context) => context.task.id === taskId,
      );
      if (index >= 0) pendingTasks.splice(index, 1);
    };

    for (;;) {
      await fillPendingTasks();
      if (pendingTasks.length === 0) break;
      if (freeVehicleCount() === 0) break;

      const availableCandidates = dispatchCandidates();
      const batteryWeight = weights?.battery ?? 0;
      const taskCandidates = pendingTasks.map(toTaskCandidate);
      const hungarianPlan = planVehicleAssignments(
        availableCandidates,
        taskCandidates,
        batteryWeight,
      );
      const greedyPlan = planVehicleAssignmentsGreedy(
        availableCandidates,
        taskCandidates,
        batteryWeight,
      );
      const assignments =
        this.matcher === 'greedy' ? greedyPlan : hungarianPlan;
      const counterfactual =
        this.matcher === 'greedy' ? hungarianPlan : greedyPlan;
      const counterfactualByTask = new Map(
        counterfactual.map((assignment) => [assignment.taskId, assignment]),
      );

      const plannedTaskIds = new Set(
        assignments.map((assignment) => assignment.taskId),
      );
      const unreachableTaskIds = pendingTasks
        .filter((context) => !plannedTaskIds.has(context.task.id))
        .filter(
          (context) =>
            !hasDispatchableVehicle(availableCandidates, {
              taskId: context.task.id,
              distanceByPoint: context.distanceByPoint,
            }),
        )
        .map((context) => context.task.id);
      if (unreachableTaskIds.length > 0) {
        for (const taskId of unreachableTaskIds) {
          removePendingTask(taskId);
          this.logger.warn(
            `Task ${taskId} has no reachable eligible vehicle — deferred`,
          );
        }
        continue;
      }

      this.logger.debug(
        `${this.matcher} plan: ${assignments
          .map(
            ({ taskId, vehicle, distance }) =>
              `${taskId}->${vehicle.name}(${distance ?? '?'})`,
          )
          .join(' ')}` +
          ` | counterfactual ${summariseDistance(counterfactual)} vs ${summariseDistance(assignments)}`,
      );

      const dispatches: PlannedAction[] = [];
      for (const { taskId, vehicle, distance } of assignments) {
        const pending = pendingTasks.find(
          (context) => context.task.id === taskId,
        );
        if (pending) dispatches.push({ context: pending, vehicle, distance });
      }
      if (dispatches.length === 0) break;

      for (const action of dispatches) {
        const { context, vehicle, distance } = action;
        removePendingTask(context.task.id);

        if (await this.pickupDependency.isBlocked(context.task)) {
          this.logger.debug(
            `Task ${context.task.id} blocked before dispatch — skipping`,
          );
          break;
        }

        const issued = await this.pickupOrders.issue(
          context.task,
          context.cargo,
          vehicle.name,
          distance,
          {
            matcher: this.matcher,
            batchSize: assignments.length,
            approachDistance: context.approachDistance,
            ...comparableCounterfactual(
              counterfactualByTask.get(context.task.id),
            ),
          },
        );
        if (!issued) {
          quarantinedVehicleNames.add(vehicle.name);
          this.logger.warn(
            `Vehicle ${vehicle.name} assignment failed — quarantined for this cycle`,
          );
          continue;
        }
        vehicle.hasActiveTask = true;
      }
    }
  }

  private logCandidates(
    readyCount: number,
    candidates: readonly VehicleCandidate[],
  ): void {
    this.logger.debug(
      `Assignment: ${readyCount} READY task(s); candidates=[` +
        candidates
          .map(
            (c) =>
              `${c.name}{disp:${c.dispatchEnabled},ign:${c.ignored},avail:${c.available},busy:${c.hasActiveTask},e:${c.energyLevel}/${c.criticalThreshold},pos:${c.currentPosition ?? '?'}}`,
          )
          .join(' ') +
        ']',
    );
  }

  private async buildContext(
    task: TransportTaskEntity,
    distances: DispatchDistances,
  ): Promise<DispatchContext | null> {
    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;
    if (!cargo?.sourcePickupLocationName) {
      this.logger.warn(`Task ${task.id} missing pickup location — skipping`);
      return null;
    }
    return {
      task,
      cargo,
      distanceByPoint: cargo.sourcePointName
        ? distances.distancesTo(cargo.sourcePointName)
        : null,
      approachDistance: await distances.approachDistanceOf(cargo),
    };
  }

  private async busyTasksByVehicle(): Promise<
    Map<string, TransportTaskEntity>
  > {
    const tasks = await this.taskRepo.find({
      where: { status: In(BUSY_STATUSES) },
    });
    const byVehicle = new Map<string, TransportTaskEntity>();
    for (const task of tasks) {
      const name = task.metadata?.assignedVehicleName;
      if (name) byVehicle.set(name, task);
    }
    return byVehicle;
  }
}

function toTaskCandidate(context: DispatchContext): DispatchTaskCandidate {
  return {
    taskId: context.task.id,
    distanceByPoint: context.distanceByPoint,
    approachDistance: context.approachDistance,
  };
}

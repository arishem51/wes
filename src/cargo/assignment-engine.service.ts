import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { ORDER_PROP, PARK_ORDER_PREFIX } from './domain/events';
import { ORDER_TYPE, buildOrderName } from './domain/transport-order-name';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { PickupDependencyService } from './pickup-dependency.service';
import { RoutingService } from './routing.service';
import { ApproachPointService } from './approach-point.service';
import {
  type DispatchMatcher,
  type DispatchTaskCandidate,
  type VehicleCandidate,
  type VehicleTaskAssignment,
  hasDispatchableVehicle,
  isEligible,
  planVehicleAssignments,
  planVehicleAssignmentsGreedy,
} from './domain/dispatch.policy';
import { shortestDistancesFrom } from './domain/routing';
import { DispatchPolicyService } from './dispatch-policy.service';

const BUSY_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

interface DispatchMeasurement {
  readonly matcher: DispatchMatcher;
  readonly batchSize: number;
  readonly altVehicleName: string | null;
  readonly altDistanceToSource: number | null;
  readonly approachDistance: number | null;
}

function summariseDistance(plan: readonly VehicleTaskAssignment[]): string {
  const known = plan.flatMap(({ distance }) =>
    distance === null ? [] : [distance],
  );
  return `${known.reduce((sum, distance) => sum + distance, 0)}(${known.length}/${plan.length})`;
}

function isFmsDispatchable(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED' &&
    state.state !== 'CHARGING'
  );
}

function isEnRouteToPark(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    state.procState === 'PROCESSING_ORDER' &&
    state.integrationLevel === 'TO_BE_UTILIZED' &&
    (state.transportOrder?.startsWith(PARK_ORDER_PREFIX) ?? false)
  );
}

@Injectable()
export class AssignmentEngineService {
  private readonly logger = new Logger(AssignmentEngineService.name);

  private readonly matcher: DispatchMatcher;

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly transportTask: TransportTaskService,
    private readonly pickupDependency: PickupDependencyService,
    private readonly routing: RoutingService,
    private readonly approachPoint: ApproachPointService,
    private readonly dispatchPolicy: DispatchPolicyService,
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

    const weights = await this.dispatchPolicy.getActiveWeights();
    const graph = await this.routing.getReverseRoadGraph();
    const distanceCache = new Map<string, ReadonlyMap<string, number>>();
    const distancesTo = (point: string): ReadonlyMap<string, number> | null => {
      if (!graph) return null;
      const cached = distanceCache.get(point);
      if (cached) return cached;
      const computed = shortestDistancesFrom(graph, point);
      distanceCache.set(point, computed);
      return computed;
    };

    const feederCache = new Map<string, readonly string[]>();
    const feedersOfZone = async (
      zoneId: string,
    ): Promise<readonly string[]> => {
      const cached = feederCache.get(zoneId);
      if (cached) return cached;
      const zone = await this.zoneRepo.findOne({
        where: { id: zoneId },
        relations: { members: true },
      });
      const feeders = zone ? await this.approachPoint.feederPointsOf(zone) : [];
      feederCache.set(zoneId, feeders);
      return feeders;
    };

    const approachDistanceOf = async (
      cargo: CargoEntity,
    ): Promise<number | null> => {
      const sourcePoint = cargo.sourcePointName;
      if (!sourcePoint || !cargo.destinationZoneId) return null;
      const feeders = await feedersOfZone(cargo.destinationZoneId);
      let shortest: number | null = null;
      for (const feeder of feeders) {
        const distance = distancesTo(feeder)?.get(sourcePoint);
        if (
          distance === undefined ||
          !Number.isFinite(distance) ||
          distance < 0
        ) {
          continue;
        }
        if (shortest === null || distance < shortest) shortest = distance;
      }
      return shortest;
    };

    const busyTasks = await this.busyTasksByVehicle();
    const candidates = await this.buildCandidates(busyTasks);
    this.logger.debug(
      `Assignment: ${tasks.length} READY task(s); candidates=[` +
        candidates
          .map(
            (c) =>
              `${c.name}{disp:${c.dispatchEnabled},ign:${c.ignored},avail:${c.available},busy:${c.hasActiveTask},e:${c.energyLevel}/${c.criticalThreshold},pos:${c.currentPosition ?? '?'}}`,
          )
          .join(' ') +
        ']',
    );

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

    type DispatchContext = {
      task: TransportTaskEntity;
      cargo: CargoEntity;
      distanceByPoint: ReadonlyMap<string, number> | null;
      approachDistance: number | null;
    };
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

        const cargo = task.cargoId
          ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
          : null;
        if (!cargo?.sourcePickupLocationName) {
          this.logger.warn(
            `Task ${task.id} missing pickup location — skipping`,
          );
          continue;
        }

        const distanceByPoint = cargo.sourcePointName
          ? distancesTo(cargo.sourcePointName)
          : null;
        const approachDistance = await approachDistanceOf(cargo);
        pendingTasks.push({ task, cargo, distanceByPoint, approachDistance });
      }
    };

    const removePendingTask = (taskId: string): DispatchContext | null => {
      const index = pendingTasks.findIndex(
        (context) => context.task.id === taskId,
      );
      if (index < 0) return null;
      return pendingTasks.splice(index, 1)[0];
    };

    for (;;) {
      await fillPendingTasks();
      if (pendingTasks.length === 0) break;
      if (freeVehicleCount() === 0) break;

      const taskCandidates: DispatchTaskCandidate[] = pendingTasks.map(
        ({ task, distanceByPoint, approachDistance }) => ({
          taskId: task.id,
          distanceByPoint,
          approachDistance,
        }),
      );
      const availableCandidates = dispatchCandidates();
      const batteryWeight = weights?.battery ?? 0;
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

      if (assignments.length === 0) break;

      for (const { taskId, vehicle, distance } of assignments) {
        const context = removePendingTask(taskId);
        if (!context) continue;

        if (await this.pickupDependency.isBlocked(context.task)) {
          this.logger.debug(
            `Task ${taskId} blocked before dispatch — skipping`,
          );
          break;
        }

        const alternative = counterfactualByTask.get(taskId);
        const assigned = await this.assign(
          context.task,
          context.cargo,
          vehicle.name,
          distance,
          {
            matcher: this.matcher,
            batchSize: assignments.length,
            altVehicleName: alternative ? alternative.vehicle.name : null,
            altDistanceToSource: alternative ? alternative.distance : null,
            approachDistance: context.approachDistance,
          },
        );
        if (!assigned) {
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

  private async buildCandidates(
    busyTasks: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<VehicleCandidate[]> {
    const agvs = await this.agvRepo.find();
    const busy = new Set(busyTasks.keys());

    const agvsByName = new Map<string, AgvEntity[]>();
    for (const agv of agvs) {
      const rows = agvsByName.get(agv.name) ?? [];
      rows.push(agv);
      agvsByName.set(agv.name, rows);
    }

    const uniqueAgvs: AgvEntity[] = [];
    for (const [name, rows] of agvsByName) {
      if (rows.length > 1) {
        this.logger.warn(
          `Duplicate AGV registry name "${name}" — excluding ${rows.length} ambiguous rows`,
        );
        continue;
      }
      uniqueAgvs.push(rows[0]);
    }

    return uniqueAgvs.map((agv) => {
      const fms = this.vehicleStore.get(agv.name);
      const hasActiveTask = busy.has(agv.name);
      return {
        name: agv.name,
        dispatchEnabled: agv.isDispatchEnabled,
        ignored: agv.isIgnored,
        available: isFmsDispatchable(fms),
        preemptibleParking: isEnRouteToPark(fms),
        energyLevel: fms?.energyLevel ?? 0,
        criticalThreshold: agv.criticalBatteryThreshold,
        currentPosition: fms?.currentPosition ?? null,
        hasActiveTask,
      };
    });
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

  private async assign(
    task: TransportTaskEntity,
    cargo: CargoEntity | null,
    vehicleName: string,
    distanceToSource: number | null,
    measurement: DispatchMeasurement,
  ): Promise<boolean> {
    if (!cargo?.sourcePickupLocationName) {
      this.logger.warn(`Task ${task.id} missing pickup location — skipping`);
      return false;
    }

    const to1Name = buildOrderName(
      ORDER_TYPE.PICKUP,
      vehicleName,
      cargo.sourcePickupLocationName,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        to1Name,
        [
          {
            locationName: cargo.sourcePickupLocationName,
            operation: this.kernelApi.loadOperation,
          },
        ],
        vehicleName,
        { [ORDER_PROP.TASK_ID]: task.id, [ORDER_PROP.LEG]: 'PICKUP' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to create TO1 for task ${task.id}: ${(err as Error).message}`,
      );
      return false;
    }

    task.assignedAt = new Date();
    task.startedAt = new Date();
    task.metadata = {
      ...task.metadata,
      assignedVehicleName: vehicleName,
      to1Name,
    };
    await this.transportTask.changeStatus(task, TaskStatus.PICKING_UP, {
      trigger: 'ASSIGNMENT_ENGINE',
      vehicleName,
      context: { to1Name, distanceToSource, ...measurement },
    });
    this.logger.log(
      `Task ${task.id} → PICKING_UP on ${vehicleName} (${to1Name})`,
    );
    return true;
  }
}

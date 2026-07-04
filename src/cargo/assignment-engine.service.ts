import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { ORDER_PROP, PARK_ORDER_PREFIX } from './domain/events';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { PickupDependencyService } from './pickup-dependency.service';
import { RoutingService } from './routing.service';
import {
  VehicleCandidate,
  pickVehicle,
  pickNearestVehicle,
} from './domain/dispatch.policy';
import { RoadGraph, shortestDistancesFrom } from './domain/routing';

const BUSY_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

function isFmsDispatchable(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED'
  );
}

/**
 * The order name to withdraw to preempt a vehicle driving to park, or null if it
 * is not preemptible. Identified by the PARK- name prefix WES itself stamps —
 * NOT inferred from "processing + no task", which could mistake a cargo order
 * (PICKUP-/APPROACH-/DROPOFF-) whose task is momentarily untracked (cancelled,
 * failed, or mid-assign) for a park order and wrongly withdraw it. The caller
 * still gates on no-active-task and battery.
 */
function preemptibleParkOrderName(
  state: KernelVehicleState | undefined,
): string | null {
  return state?.procState === 'PROCESSING_ORDER' &&
    state.integrationLevel === 'TO_BE_UTILIZED' &&
    state.transportOrder?.startsWith(PARK_ORDER_PREFIX)
    ? state.transportOrder
    : null;
}

@Injectable()
export class AssignmentEngineService {
  private readonly logger = new Logger(AssignmentEngineService.name);

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly transportTask: TransportTaskService,
    private readonly pickupDependency: PickupDependencyService,
    private readonly routing: RoutingService,
  ) {}

  async run(): Promise<void> {
    const tasks = await this.taskRepo.find({
      where: { status: TaskStatus.READY_TO_ASSIGN },
      order: { createdAt: 'ASC' },
    });
    if (tasks.length === 0) return;

    const candidates = await this.buildCandidates();
    this.logger.debug(
      `Assignment: ${tasks.length} READY task(s); candidates=[` +
        candidates
          .map(
            (c) =>
              `${c.name}{disp:${c.dispatchEnabled},ign:${c.ignored},avail:${c.available},busy:${c.hasActiveTask},e:${c.energyLevel}/${c.operationalThreshold},pos:${c.currentPosition ?? '?'}}`,
          )
          .join(' ') +
        ']',
    );

    // One graph for the whole cycle; null when the plant model is unavailable,
    // in which case selection falls back to deterministic name order.
    const graph = await this.routing.getRoadGraph();

    for (const task of tasks) {
      // Guard: the lane may have become blocked since release decided this
      // task was free (a closer-to-aisle cargo was added). Skip it; the next
      // ReleaseEngine pass demotes it to BLOCKED.
      if (await this.pickupDependency.isBlocked(task)) {
        this.logger.debug(`Task ${task.id} blocked at assign time — skipping`);
        continue;
      }

      const cargo = task.cargoId
        ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
        : null;

      const { vehicle, distance } = this.selectVehicle(
        candidates,
        graph,
        cargo,
      );
      if (!vehicle) break; // no eligible AGV right now — try again next cycle

      const assigned = await this.assign(
        task,
        cargo,
        vehicle.name,
        distance,
        vehicle.parkOrderName,
      );
      if (assigned) {
        // Don't hand the same vehicle two tasks in one cycle.
        vehicle.hasActiveTask = true;
      }
    }
  }

  /**
   * Pick the nearest eligible vehicle to the cargo's source point via Dijkstra
   * over the road graph. Falls back to name-order picking when the graph or the
   * cargo's source point is unavailable (§6.1). Also returns the picked
   * vehicle's graph distance to the source (null on the fallback path) so the
   * assignment can log it for evaluation.
   */
  private selectVehicle(
    candidates: VehicleCandidate[],
    graph: RoadGraph | null,
    cargo: CargoEntity | null,
  ): { vehicle: VehicleCandidate | null; distance: number | null } {
    if (graph && cargo?.sourcePointName) {
      const distances = shortestDistancesFrom(graph, cargo.sourcePointName);
      const vehicle = pickNearestVehicle(candidates, distances);
      const distance =
        vehicle?.currentPosition != null
          ? (distances.get(vehicle.currentPosition) ?? null)
          : null;
      return { vehicle, distance };
    }
    return { vehicle: pickVehicle(candidates), distance: null };
  }

  private async buildCandidates(): Promise<VehicleCandidate[]> {
    const agvs = await this.agvRepo.find();
    const busy = await this.busyVehicleNames();

    return agvs.map((agv) => {
      const fms = this.vehicleStore.get(agv.name);
      const hasActiveTask = busy.has(agv.name);
      // Only a vehicle without a cargo task can be preempted from parking.
      const parkOrderName = hasActiveTask
        ? null
        : preemptibleParkOrderName(fms);
      return {
        name: agv.name,
        dispatchEnabled: agv.isDispatchEnabled,
        ignored: agv.isIgnored,
        available: isFmsDispatchable(fms),
        preemptibleParking: parkOrderName !== null,
        parkOrderName,
        energyLevel: fms?.energyLevel ?? 0,
        operationalThreshold: agv.operationalBatteryThreshold,
        currentPosition: fms?.currentPosition ?? null,
        hasActiveTask,
      };
    });
  }

  private async busyVehicleNames(): Promise<Set<string>> {
    const tasks = await this.taskRepo.find({
      where: { status: In(BUSY_STATUSES) },
    });
    const names = new Set<string>();
    for (const task of tasks) {
      const name = task.metadata?.assignedVehicleName;
      if (name) names.add(name);
    }
    return names;
  }

  private async assign(
    task: TransportTaskEntity,
    cargo: CargoEntity | null,
    vehicleName: string,
    distanceToSource: number | null,
    parkOrderName: string | null,
  ): Promise<boolean> {
    // TO1 (PICK_UP) only needs the source; the drop-off slot is committed later,
    // at the TO2 barrier, so destinationLocationName is intentionally still null.
    if (!cargo?.sourcePickupLocationName) {
      this.logger.warn(`Task ${task.id} missing pickup location — skipping`);
      return false;
    }

    // Preempt: this vehicle is en route to a park order. Withdraw it first so the
    // kernel frees the vehicle to take the pickup (graceful withdraw — it halts at
    // the next point, then TO1 dispatches). Abort on failure; the task stays
    // READY_TO_ASSIGN and is retried next cycle. The ParkingEngine's point
    // reservation clears on its own once the vehicle leaves the park order.
    if (parkOrderName) {
      try {
        await this.kernelApi.withdrawTransportOrder(parkOrderName);
        this.logger.log(
          `Preempting park order ${parkOrderName} on ${vehicleName} for task ${task.id}`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to withdraw park order ${parkOrderName} on ${vehicleName}: ${(err as Error).message}`,
        );
        return false;
      }
    }

    // Opaque unique name so re-assigning a task (e.g. after a preempt) never
    // collides with the withdrawn order still held in openTCS. The task is
    // correlated back via the wes:taskId property, not the name.
    const to1Name = `PICKUP-${randomUUID()}`;
    try {
      await this.kernelApi.createTransportOrder(
        to1Name,
        [
          {
            locationName: cargo.sourcePickupLocationName,
            operation: 'PICK_UP',
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
      context: { to1Name, distanceToSource },
    });
    this.logger.log(
      `Task ${task.id} → PICKING_UP on ${vehicleName} (${to1Name})`,
    );
    return true;
  }
}

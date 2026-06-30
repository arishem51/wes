import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { VehicleCandidate, pickVehicle } from './domain/dispatch.policy';

const BUSY_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

function isFmsDispatchable(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED'
  );
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
              `${c.name}{disp:${c.dispatchEnabled},ign:${c.ignored},avail:${c.available},busy:${c.hasActiveTask},e:${c.energyLevel}/${c.operationalThreshold}}`,
          )
          .join(' ') +
        ']',
    );

    for (const task of tasks) {
      // Guard: the lane may have become blocked since release decided this
      // task was free (a closer-to-aisle cargo was added). Skip it; the next
      // ReleaseEngine pass demotes it to BLOCKED.
      if (await this.pickupDependency.isBlocked(task)) {
        this.logger.debug(`Task ${task.id} blocked at assign time — skipping`);
        continue;
      }

      const vehicle = pickVehicle(candidates);
      if (!vehicle) break; // no eligible AGV right now — try again next cycle

      const assigned = await this.assign(task, vehicle.name);
      if (assigned) {
        // Don't hand the same vehicle two tasks in one cycle.
        vehicle.hasActiveTask = true;
      }
    }
  }

  private async buildCandidates(): Promise<VehicleCandidate[]> {
    const agvs = await this.agvRepo.find();
    const busy = await this.busyVehicleNames();

    return agvs.map((agv) => {
      const fms = this.vehicleStore.get(agv.name);
      return {
        name: agv.name,
        dispatchEnabled: agv.isDispatchEnabled,
        ignored: agv.isIgnored,
        available: isFmsDispatchable(fms),
        energyLevel: fms?.energyLevel ?? 0,
        operationalThreshold: agv.operationalBatteryThreshold,
        hasActiveTask: busy.has(agv.name),
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
    vehicleName: string,
  ): Promise<boolean> {
    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;

    if (!cargo?.sourcePickupLocationName || !cargo?.destinationLocationName) {
      this.logger.warn(`Task ${task.id} missing location names — skipping`);
      return false;
    }

    const to1Name = `TO1-${task.id}`;
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
    await this.transportTask.changeStatus(task, TaskStatus.PICKING_UP);
    this.logger.log(
      `Task ${task.id} → PICKING_UP on ${vehicleName} (${to1Name})`,
    );
    return true;
  }
}

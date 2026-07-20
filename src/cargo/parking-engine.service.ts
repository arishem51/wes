import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { ORDER_PROP, PARK_ORDER_PREFIX } from './domain/events';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { RoutingService } from './routing.service';
import { shortestDistancesFrom } from './domain/routing';
import { nonNegativeOr } from './domain/dispatch-cost';
import {
  ParkVehicleCandidate,
  needsParking,
  pickParkingPoint,
} from './domain/parking.policy';

const DEFAULT_PARK_IDLE_DELAY_MS = 0;
const PARK_LEG = 'PARK';
const ACTIVE_TASK_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

function isIdleAvailable(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED'
  );
}

@Injectable()
export class ParkingEngineService {
  private readonly logger = new Logger(ParkingEngineService.name);
  private readonly idleSince = new Map<string, number>();
  private readonly parkTargets = new Map<
    string,
    { point: string; order: string }
  >();
  private readonly parkIdleDelayMs: number;

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly routing: RoutingService,
  ) {
    this.parkIdleDelayMs = nonNegativeOr(
      Number(process.env.PARK_IDLE_DELAY_MS),
      DEFAULT_PARK_IDLE_DELAY_MS,
    );
    this.logger.log(
      this.parkIdleDelayMs === 0
        ? 'Park idle delay: 0ms — idle vehicles park on the first flush that sees them'
        : `Park idle delay: ${this.parkIdleDelayMs}ms`,
    );
  }

  async run(): Promise<void> {
    const parkingPoints = await this.kernelApi.getParkingPoints();
    if (parkingPoints.length === 0) return;
    const parkPointNames = new Set(parkingPoints.map((p) => p.name));

    const hasPendingWork = await this.hasPendingWork();
    const busy = await this.busyVehicleNames();
    const agvs = await this.agvRepo.find();
    const now = Date.now();

    const readyToPark: Array<{ name: string; position: string }> = [];
    const stillCandidate = new Set<string>();

    for (const agv of agvs) {
      const fms = this.vehicleStore.get(agv.name);
      const candidate = this.toCandidate(agv, fms, busy);
      if (!needsParking(candidate, parkPointNames, hasPendingWork)) continue;

      stillCandidate.add(agv.name);
      const since = this.idleSince.get(agv.name) ?? now;
      this.idleSince.set(agv.name, since);
      if (now - since >= this.parkIdleDelayMs && candidate.currentPosition) {
        readyToPark.push({
          name: agv.name,
          position: candidate.currentPosition,
        });
      }
    }

    for (const name of [...this.idleSince.keys()]) {
      if (!stillCandidate.has(name)) this.idleSince.delete(name);
    }

    if (readyToPark.length === 0) return;

    const graph = await this.routing.getRoadGraph();
    const excluded = this.occupiedParkPoints(agvs, parkPointNames);
    for (const target of this.inFlightParkTargets().values()) {
      excluded.add(target);
    }

    for (const { name, position } of readyToPark) {
      const distances = graph
        ? shortestDistancesFrom(graph, position)
        : new Map<string, number>();
      const point = pickParkingPoint(parkingPoints, distances, excluded);
      if (!point) {
        this.logger.debug(
          `No free park point reachable for ${name} — skipping`,
        );
        continue;
      }
      excluded.add(point.name);
      await this.createParkOrder(name, point.name);
    }
  }

  private toCandidate(
    agv: AgvEntity,
    fms: KernelVehicleState | undefined,
    busy: ReadonlySet<string>,
  ): ParkVehicleCandidate {
    return {
      name: agv.name,
      dispatchEnabled: agv.isDispatchEnabled,
      ignored: agv.isIgnored,
      idleAvailable: isIdleAvailable(fms),
      onOrder: fms?.transportOrder != null,
      hasActiveTask: busy.has(agv.name),
      currentPosition: fms?.currentPosition ?? null,
    };
  }

  private async hasPendingWork(): Promise<boolean> {
    const count = await this.taskRepo.count({
      where: { status: TaskStatus.READY_TO_ASSIGN },
    });
    return count > 0;
  }

  private async busyVehicleNames(): Promise<Set<string>> {
    const tasks = await this.taskRepo.find({
      where: { status: In(ACTIVE_TASK_STATUSES) },
    });
    const names = new Set<string>();
    for (const task of tasks) {
      const name = task.metadata?.assignedVehicleName;
      if (name) names.add(name);
    }
    return names;
  }

  private inFlightParkTargets(): Map<string, string> {
    const live = new Map<string, string>();
    for (const [vehicle, target] of [...this.parkTargets]) {
      if (this.vehicleStore.get(vehicle)?.transportOrder === target.order) {
        live.set(vehicle, target.point);
      } else {
        this.parkTargets.delete(vehicle);
      }
    }
    return live;
  }

  private occupiedParkPoints(
    agvs: AgvEntity[],
    parkPointNames: ReadonlySet<string>,
  ): Set<string> {
    const occupied = new Set<string>();
    for (const agv of agvs) {
      const pos = this.vehicleStore.get(agv.name)?.currentPosition;
      if (pos && parkPointNames.has(pos)) occupied.add(pos);
    }
    return occupied;
  }

  private async createParkOrder(
    vehicleName: string,
    pointName: string,
  ): Promise<void> {
    const orderName = `${PARK_ORDER_PREFIX}${randomUUID()}`;
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: pointName, operation: 'MOVE' }],
        vehicleName,
        { [ORDER_PROP.LEG]: PARK_LEG },
      );
      this.idleSince.delete(vehicleName);
      this.parkTargets.set(vehicleName, { point: pointName, order: orderName });
      this.logger.log(`Parking ${vehicleName} → ${pointName} (${orderName})`);
    } catch (err) {
      this.logger.warn(
        `Failed to park ${vehicleName}: ${(err as Error).message}`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { ORDER_PROP } from './domain/events';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';
import { ParkClaimStore } from './park-claim.store';
import { RoutingService } from './routing.service';
import { shortestDistancesFrom } from './domain/routing';
import { activeCargoVehicleNames } from './task-queries';
import {
  ORDER_TYPE,
  buildOrderName,
  parkPointFromOrderName,
} from './domain/transport-order-name';
import {
  ParkingPoint,
  ParkVehicleCandidate,
  needsParking,
  pickParkingPoint,
} from './domain/parking.policy';

const PARK_LEG = 'PARK';
const PENDING_WORK_STATUSES = [TaskStatus.READY_TO_ASSIGN];

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

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly routing: RoutingService,
    private readonly parkClaims: ParkClaimStore,
  ) {}

  async run(): Promise<void> {
    const parkingPoints = await this.parkPool();
    if (parkingPoints.length === 0) return;
    const parkPointNames = new Set(parkingPoints.map((p) => p.name));

    const hasPendingWork = await this.hasPendingWork();
    const busy = await activeCargoVehicleNames(this.taskRepo);
    const agvs = await this.agvRepo.find();

    const readyToPark: Array<{ name: string; position: string }> = [];

    for (const agv of agvs) {
      const fms = this.vehicleStore.get(agv.name);
      const candidate = this.toCandidate(agv, fms, busy);
      if (!needsParking(candidate, parkPointNames, hasPendingWork)) continue;
      if (!candidate.currentPosition) continue;
      readyToPark.push({ name: agv.name, position: candidate.currentPosition });
    }

    if (readyToPark.length === 0) return;

    if (!this.parkClaims.isReady()) {
      this.logger.warn(
        'Park claims not rehydrated from the kernel — skipping this park pass',
      );
      return;
    }

    const claimedVehicles = this.parkClaims.claimedVehicles();
    const unclaimed: typeof readyToPark = [];
    for (const vehicle of readyToPark) {
      if (claimedVehicles.has(vehicle.name)) {
        this.logger.log(
          `${vehicle.name} already has a live park order — keeping its target`,
        );
        continue;
      }
      unclaimed.push(vehicle);
    }

    const graph = await this.routing.getRoadGraph();
    const excluded = this.unavailableParkPoints(parkPointNames);
    const claimedPoints = this.parkClaims.claimedPoints();
    for (const point of claimedPoints) excluded.add(point);
    this.logParkDecisionInput(unclaimed, claimedVehicles, claimedPoints);

    for (const { name, position } of unclaimed) {
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

  private logParkDecisionInput(
    unclaimed: readonly { name: string }[],
    claimedVehicles: ReadonlySet<string>,
    claimedPoints: ReadonlySet<string>,
  ): void {
    this.logger.debug(
      `Park pass: ready=[${unclaimed.map((v) => v.name).join(' ')}]` +
        ` claimedVehicles=[${[...claimedVehicles].join(' ')}]` +
        ` claimedPoints=[${[...claimedPoints].join(' ')}]`,
    );
  }

  private async parkPool(): Promise<ParkingPoint[]> {
    const parkingPoints = await this.kernelApi.getParkingPoints();
    const chargeLocations = await this.kernelApi.getChargeLocations();
    const chargePoints = new Set<string>();
    for (const location of chargeLocations) {
      for (const point of location.points) chargePoints.add(point);
    }
    return parkingPoints.filter((p) => !chargePoints.has(p.name));
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
      belowCritical:
        fms != null && fms.energyLevel <= agv.criticalBatteryThreshold,
      charging: fms?.state === 'CHARGING',
      currentPosition: fms?.currentPosition ?? null,
    };
  }

  private async hasPendingWork(): Promise<boolean> {
    const count = await this.taskRepo.count({
      where: { status: In(PENDING_WORK_STATUSES) },
    });
    return count > 0;
  }

  private unavailableParkPoints(
    parkPointNames: ReadonlySet<string>,
  ): Set<string> {
    const excluded = new Set<string>();
    for (const state of this.vehicleStore.getAll()) {
      const position = state.currentPosition;
      if (position && parkPointNames.has(position)) excluded.add(position);

      const target = parkPointFromOrderName(state.transportOrder, state.name);
      if (target && parkPointNames.has(target)) excluded.add(target);
    }
    return excluded;
  }

  private async createParkOrder(
    vehicleName: string,
    pointName: string,
  ): Promise<void> {
    const orderName = buildOrderName(
      ORDER_TYPE.PARK,
      vehicleName,
      pointName,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: pointName, operation: 'MOVE' }],
        vehicleName,
        { [ORDER_PROP.LEG]: PARK_LEG },
        { dispensable: true },
      );
      this.parkClaims.claim(vehicleName, pointName, orderName);
      this.logger.log(`Parking ${vehicleName} → ${pointName} (${orderName})`);
    } catch (err) {
      this.logger.warn(
        `Failed to park ${vehicleName}: ${(err as Error).message}`,
      );
    }
  }
}

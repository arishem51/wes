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
import {
  ParkVehicleCandidate,
  needsParking,
  pickParkingPoint,
} from './domain/parking.policy';

const PARK_IDLE_DELAY_MS = Number(process.env.PARK_IDLE_DELAY_MS ?? 10_000);
/** `wes:leg` value stamped on park orders. Not a TaskLeg — the listener's leg
 *  gate ignores it, so park orders never reach the cargo saga. */
const PARK_LEG = 'PARK';
const ACTIVE_TASK_STATUSES = [TaskStatus.PICKING_UP, TaskStatus.DELIVERING];

function isIdleAvailable(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED'
  );
}

/**
 * Sends idle vehicles to a parking position once they have been idle with no
 * cargo work for PARK_IDLE_DELAY_MS. Runs at the tail of the dispatch flush
 * (release → assign → park), so a vehicle only parks when assignment did not
 * claim it. openTCS's own parkIdleVehicles is left off — WES owns parking so it
 * can preempt a park order the instant cargo arrives (see AssignmentEngine).
 */
@Injectable()
export class ParkingEngineService {
  private readonly logger = new Logger(ParkingEngineService.name);
  /**
   * vehicleName → epoch ms when it first became a parking candidate. In-RAM by
   * design: on restart it simply re-arms the delay, which is safe (parking is
   * not time-critical) and avoids persisting derived state. The reconcile is
   * level-triggered, so a lost event never strands this — the next flush
   * recomputes it from the fresh vehicle snapshot.
   */
  private readonly idleSince = new Map<string, number>();
  /**
   * vehicleName → the park point it is currently driving to and the order name
   * carrying it. A vehicle en route to a park point does not yet stand on it, so
   * `occupiedParkPoints` cannot see the reservation; without this a second
   * vehicle could be sent to the same point (openTCS holds one vehicle per point,
   * so the second would block forever). Cleared precisely when the vehicle is no
   * longer processing that order (arrived → idle, or preempted onto a cargo TO).
   */
  private readonly parkTargets = new Map<
    string,
    { point: string; order: string }
  >();

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly routing: RoutingService,
  ) {}

  async run(): Promise<void> {
    const parkingPoints = await this.kernelApi.getParkingPoints();
    if (parkingPoints.length === 0) return; // model has no park positions
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
      const since = this.idleSince.get(agv.name);
      if (since === undefined) {
        this.idleSince.set(agv.name, now);
        continue; // clock just started — cannot have elapsed the delay yet
      }
      // needsParking guarantees currentPosition is a non-null non-park point.
      if (now - since >= PARK_IDLE_DELAY_MS && candidate.currentPosition) {
        readyToPark.push({
          name: agv.name,
          position: candidate.currentPosition,
        });
      }
    }

    // Stop the clock for vehicles that are no longer parking candidates
    // (took a task, moved, went offline).
    for (const name of [...this.idleSince.keys()]) {
      if (!stillCandidate.has(name)) this.idleSince.delete(name);
    }

    if (readyToPark.length === 0) return;

    const graph = await this.routing.getRoadGraph();
    // Exclude park points a vehicle already stands on, points a vehicle is still
    // driving to (in-flight reservations), plus any point picked this cycle — so
    // two vehicles are never sent to the same spot within or across ticks.
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

  /**
   * True when cargo is waiting to be assigned. Only READY_TO_ASSIGN counts:
   * CREATED tasks are released earlier in the same flush, and BLOCKED tasks
   * cannot be served now — counting them would strand vehicles unparked while a
   * row dependency persists. If a BLOCKED task later frees, the assignment
   * engine preempts a parking/parked vehicle for it.
   */
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

  /**
   * Prune finished/preempted reservations, then return the still-live ones
   * (vehicleName → target point). A reservation is live only while the vehicle is
   * still processing exactly the park order we issued; once its `transportOrder`
   * differs (arrived and idle → null, or preempted onto a cargo order) the point
   * is free again.
   */
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
    // The PARK- prefix lets AssignmentEngine recognize (and preempt) this order
    // from the vehicle snapshot; the uuid keeps the name unique so re-issuing
    // never collides with a withdrawn order still held in openTCS. Carries no
    // wes:taskId, so the listener's leg gate ignores it and it never enters the saga.
    const orderName = `${PARK_ORDER_PREFIX}${randomUUID()}`;
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: pointName, operation: 'MOVE' }],
        vehicleName,
        { [ORDER_PROP.LEG]: PARK_LEG },
      );
      // The vehicle goes PROCESSING_ORDER and drops out of the candidate set next
      // tick; clear the clock now so a duplicate order is never issued.
      this.idleSince.delete(vehicleName);
      // Reserve the point until the vehicle stops processing this order, so no
      // other vehicle is sent there while it is still en route.
      this.parkTargets.set(vehicleName, { point: pointName, order: orderName });
      this.logger.log(`Parking ${vehicleName} → ${pointName} (${orderName})`);
    } catch (err) {
      this.logger.warn(
        `Failed to park ${vehicleName}: ${(err as Error).message}`,
      );
    }
  }
}

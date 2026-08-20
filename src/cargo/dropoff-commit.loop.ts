import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, QueryRunner, Repository } from 'typeorm';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TaskStatus,
  TransportTaskEntity,
} from './entities/transport-task.entity';
import { DeliverySlotEngine } from './delivery-slot.engine';
import {
  SlotReservationService,
  type SlotCommitResult,
} from './slot-reservation.service';
import { VehicleAimService } from './vehicle-aim.service';
import {
  serveOrder,
  spotInReservedLane,
  standsOnASlot,
} from './domain/dropoff-lane';
import {
  laneOfLocation,
  waitingTargetsFor,
  type ZoneLane,
  type ZoneSlotLayout,
} from './domain/zone-slot-layout';

const TICK_MS = 200;
const SINGLE_RUNNER_LOCK_KEY = 815_004_711;
const RUNNER_LOCK_RECHECK_MS = 10_000;

interface CommitCandidate {
  readonly task: TransportTaskEntity;
  readonly vehicle: string;
  readonly cargo: CargoEntity;
  readonly zone: ZoneEntity;
  readonly layout: ZoneSlotLayout;
  readonly lane: ZoneLane;
  readonly depth: number;
}

@Injectable()
export class DropoffCommitLoop implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DropoffCommitLoop.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private runnerLock: RunnerLock | null = null;
  private lockVerifiedAt = 0;

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly vehicleStore: VehicleStateStore,
    private readonly deliverySlotEngine: DeliverySlotEngine,
    private readonly slotReservation: SlotReservationService,
    private readonly vehicleAim: VehicleAimService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.releaseRunnerLock();
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!(await this.holdsRunnerLock())) return;

      const tasks = await this.tasksAwaitingCommit();
      const candidates = await this.commitCandidates(tasks);
      const taskByCargoId = new Map(
        tasks
          .filter((task) => task.cargoId)
          .map((task) => [task.cargoId!, task] as const),
      );
      for (const candidate of serveOrder(candidates)) {
        await this.commitOne(candidate, taskByCargoId);
      }
    } catch (err) {
      this.logger.error(
        `Drop-off commit tick failed: ${(err as Error).message}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async tasksAwaitingCommit(): Promise<TransportTaskEntity[]> {
    return this.taskRepo.find({
      where: { status: TaskStatus.DELIVERING, cargoId: Not(IsNull()) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  private async commitCandidates(
    tasks: readonly TransportTaskEntity[],
  ): Promise<CommitCandidate[]> {
    const candidates: CommitCandidate[] = [];
    for (const task of tasks) {
      const candidate = await this.candidateFor(task);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  private async candidateFor(
    task: TransportTaskEntity,
  ): Promise<CommitCandidate | null> {
    const vehicle = task.metadata?.assignedVehicleName;
    const position = vehicle
      ? this.vehicleStore.get(vehicle)?.currentPosition
      : null;
    if (!vehicle || !position) return null;

    const cargo = await this.cargoRepo.findOne({
      where: { id: task.cargoId!, status: In([CargoStatus.ACTIVE]) },
    });
    if (
      !cargo ||
      cargo.destinationLocationName ||
      !cargo.destinationZoneId ||
      !cargo.reservedLocationName
    ) {
      return null;
    }
    const reservedTarget = cargo.reservedLocationName;

    const zone = await this.zoneRepo.findOne({
      where: { id: cargo.destinationZoneId },
      relations: { members: true },
    });
    if (!zone) return null;

    const layout = await this.deliverySlotEngine.layoutFor(zone);
    if (!layout) return null;

    const spot = spotInReservedLane(layout, reservedTarget, position);
    if (!spot) return null;

    return {
      task,
      vehicle,
      cargo,
      zone,
      layout,
      lane: spot.lane,
      depth: spot.depth,
    };
  }

  // TODO: nothing releases a lane when the drop-off never completes. A cargo
  // that is committed but never reaches unloadedAt — drop-off order FAILED or
  // UNROUTABLE, order withdrawn, vehicle fault or lost navigation — blocks its
  // lane forever, and every vehicle reserved into that lane waits behind it.
  // Needs both a timeout on the committed-but-not-unloaded state and a release
  // on terminal order state, which then has to hand the slot back to ranking.
  private async slotsOfBusyLanes(
    candidate: CommitCandidate,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<Set<string>> {
    const inFlight = await this.cargoRepo.find({
      where: {
        destinationZoneId: candidate.zone.id,
        status: CargoStatus.ACTIVE,
        destinationLocationName: Not(IsNull()),
      },
    });

    const blocked = new Set<string>();
    for (const cargo of inFlight) {
      const lane = laneOfLocation(
        candidate.layout,
        cargo.destinationLocationName!,
      );
      if (!lane) continue;
      if (this.hasLeftLane(cargo, lane, taskByCargoId)) continue;
      for (const slot of lane.slots) blocked.add(slot.locationName);
    }
    return blocked;
  }

  private hasLeftLane(
    cargo: CargoEntity,
    lane: ZoneLane,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): boolean {
    const task = taskByCargoId.get(cargo.id);
    if (!task?.metadata?.unloadedAt) return false;

    const vehicle = task.metadata.assignedVehicleName;
    const position = vehicle
      ? this.vehicleStore.get(vehicle)?.currentPosition
      : null;
    if (!position) return false;

    return !standsOnASlot(lane, position);
  }

  private async commitOne(
    candidate: CommitCandidate,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<void> {
    try {
      await this.commitCandidate(candidate, taskByCargoId);
    } catch (err) {
      this.logger.error(
        `Task ${candidate.task.id}: ${candidate.vehicle} failed mid-commit in lane ${candidate.lane.axis}: ${(err as Error).message}`,
      );
    }
  }

  private async commitCandidate(
    candidate: CommitCandidate,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<void> {
    const result = await this.slotReservation.commit(
      candidate.cargo.id,
      candidate.zone,
      {
        lane: candidate.lane,
        blockedLocationNames: await this.slotsOfBusyLanes(
          candidate,
          taskByCargoId,
        ),
      },
    );
    if (!result) return;

    await this.applyCommit(candidate, result, taskByCargoId);
  }

  private async applyCommit(
    candidate: CommitCandidate,
    result: SlotCommitResult,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<void> {
    const { task, vehicle } = candidate;
    const dropping = await this.vehicleAim.dropAt(
      { task, vehicle, cargoId: candidate.cargo.id },
      candidate.zone,
      candidate.layout,
      result.slot,
      result.keptOwnReservation,
    );
    if (!dropping) return;

    this.logger.log(`Task ${task.id}: ${vehicle} committed ${result.slot}`);

    if (result.displaced) {
      await this.recordDisplaced(result, vehicle, taskByCargoId);
    }
    await this.reaimLane(candidate, result.slot, taskByCargoId);
  }

  private async reaimLane(
    candidate: CommitCandidate,
    committedSlot: string,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<void> {
    const lane = laneOfLocation(candidate.layout, committedSlot);
    if (!lane) return;

    const committedPoint = lane.slots.find(
      (slot) => slot.locationName === committedSlot,
    )?.pointName;
    if (!committedPoint) return;

    const chain = waitingTargetsFor(lane, committedPoint);
    const waiting = await this.waitingBehind(candidate, lane, taskByCargoId);
    for (const [index, entry] of waiting.entries()) {
      const target = chain[index];
      if (!target) {
        this.logger.warn(
          `Task ${entry.task.id}: ${entry.vehicle} has nowhere left to wait behind ${committedSlot}`,
        );
        continue;
      }
      await this.vehicleAim.queueAt(
        entry,
        candidate.zone,
        candidate.layout,
        target,
      );
    }
  }

  private async waitingBehind(
    candidate: CommitCandidate,
    lane: ZoneLane,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<
    { task: TransportTaskEntity; vehicle: string; cargoId: string }[]
  > {
    const laneTargets = new Set<string>([
      ...lane.slots.map((slot) => slot.locationName),
      ...lane.axisPoints,
    ]);
    const cargos = await this.cargoRepo.find({
      where: {
        destinationZoneId: candidate.zone.id,
        status: CargoStatus.ACTIVE,
        destinationLocationName: IsNull(),
      },
    });

    const waiting: {
      task: TransportTaskEntity;
      vehicle: string;
      cargoId: string;
      distance: number;
    }[] = [];
    for (const cargo of cargos) {
      if (cargo.id === candidate.cargo.id) continue;
      if (
        !cargo.reservedLocationName ||
        !laneTargets.has(cargo.reservedLocationName)
      ) {
        continue;
      }
      const task = taskByCargoId.get(cargo.id);
      const vehicle = task?.metadata?.assignedVehicleName;
      if (!task || !vehicle) continue;

      const position = this.vehicleStore.get(vehicle)?.currentPosition;
      const onAxis = position ? lane.axisPoints.indexOf(position) : -1;
      waiting.push({
        task,
        vehicle,
        cargoId: cargo.id,
        distance: onAxis === -1 ? Number.MAX_SAFE_INTEGER : onAxis,
      });
    }

    return waiting
      .sort((a, b) => a.distance - b.distance)
      .map(({ task, vehicle, cargoId }) => ({ task, vehicle, cargoId }));
  }

  private async recordDisplaced(
    result: SlotCommitResult,
    winner: string,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<void> {
    const displaced = result.displaced!;
    const victim =
      taskByCargoId.get(displaced.cargoId) ??
      (await this.taskRepo.findOne({
        where: { cargoId: displaced.cargoId, status: TaskStatus.DELIVERING },
      }));
    if (!victim) return;

    const victimVehicle = victim.metadata?.assignedVehicleName;
    if (!victimVehicle) return;

    if (!displaced.replacementSlot) {
      this.logger.error(
        `Task ${victim.id}: ${victimVehicle} lost ${displaced.lostSlot} to ${winner} and no slot is left`,
      );
      return;
    }

    victim.metadata = {
      ...victim.metadata,
      swapCount: (victim.metadata?.swapCount ?? 0) + 1,
    };
    await this.taskRepo.save(victim);
    this.logger.log(
      `Task ${victim.id}: ${victimVehicle} lost ${displaced.lostSlot} to ${winner}, now reserved ${displaced.replacementSlot} (still waiting at the gate)`,
    );
  }

  private async holdsRunnerLock(): Promise<boolean> {
    if (this.runnerLock && !(await this.lockStillAlive())) {
      this.logger.warn(
        'Lost the drop-off commit lock, taking it again if it is free',
      );
      await this.releaseRunnerLock();
    }
    if (this.runnerLock) return true;

    this.runnerLock = await this.acquireSingleRunnerLock();
    if (this.runnerLock) {
      this.lockVerifiedAt = Date.now();
      this.logger.log('Now running the drop-off commit loop');
    }
    return this.runnerLock !== null;
  }

  private async lockStillAlive(): Promise<boolean> {
    const lock = this.runnerLock;
    if (!lock) return false;
    if (Date.now() - this.lockVerifiedAt < RUNNER_LOCK_RECHECK_MS) return true;

    const alive = await lock.ping();
    if (alive) this.lockVerifiedAt = Date.now();
    return alive;
  }

  private async releaseRunnerLock(): Promise<void> {
    const lock = this.runnerLock;
    this.runnerLock = null;
    this.lockVerifiedAt = 0;
    if (!lock) return;
    try {
      await lock.release();
    } catch (err) {
      this.logger.warn(
        `Could not release the drop-off commit lock: ${(err as Error).message}`,
      );
    }
  }

  private async acquireSingleRunnerLock(): Promise<RunnerLock | null> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [SINGLE_RUNNER_LOCK_KEY],
      )) as { locked: boolean }[];
      if (locked) return runnerLockOn(runner);
    } catch (err) {
      this.logger.warn(
        `Could not reach the database for the drop-off commit lock: ${(err as Error).message}`,
      );
    }
    await runner.release().catch(() => undefined);
    return null;
  }
}

interface RunnerLock {
  ping: () => Promise<boolean>;
  release: () => Promise<void>;
}

function runnerLockOn(runner: QueryRunner): RunnerLock {
  return {
    ping: async () => {
      try {
        await runner.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    release: async () => {
      try {
        await runner.query('SELECT pg_advisory_unlock($1)', [
          SINGLE_RUNNER_LOCK_KEY,
        ]);
      } finally {
        await runner.release();
      }
    },
  };
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TaskStatus,
  TransportTaskEntity,
} from './entities/transport-task.entity';
import { DeliverySlotEngine } from './delivery-slot.engine';
import { DropoffOrderService } from './dropoff-order.service';
import {
  SlotReservationService,
  type SlotCommitResult,
} from './slot-reservation.service';
import { columnIndexOfPoint } from './domain/zone-slot-layout';

const TICK_MS = 500;
const SINGLE_RUNNER_LOCK_KEY = 815_004_711;

interface CommitCandidate {
  readonly task: TransportTaskEntity;
  readonly vehicle: string;
  readonly cargo: CargoEntity;
  readonly zone: ZoneEntity;
  readonly atGate: boolean;
  readonly insideColumn: number | null;
}

@Injectable()
export class DropoffCommitLoop implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DropoffCommitLoop.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private runnerLock: { release: () => Promise<void> } | null = null;

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
    private readonly dropoffOrder: DropoffOrderService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.runnerLock = await this.acquireSingleRunnerLock();
    if (!this.runnerLock) {
      this.logger.log(
        'Another instance already runs the drop-off commit loop — staying idle',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.runnerLock?.release();
    this.runnerLock = null;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const candidates = await this.commitCandidates();
      const insideColumnByCargoId = insideColumnMap(candidates);
      const taskByCargoId = new Map(
        candidates.map((candidate) => [candidate.cargo.id, candidate.task]),
      );
      for (const candidate of gateFirst(candidates)) {
        await this.commitCandidate(
          candidate,
          insideColumnByCargoId,
          taskByCargoId,
        );
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

  private async commitCandidates(): Promise<CommitCandidate[]> {
    const candidates: CommitCandidate[] = [];
    for (const task of await this.tasksAwaitingCommit()) {
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
    if (!cargo || cargo.destinationLocationName || !cargo.destinationZoneId) {
      return null;
    }

    const zone = await this.zoneRepo.findOne({
      where: { id: cargo.destinationZoneId },
      relations: { members: true },
    });
    if (!zone) return null;

    const layout = await this.deliverySlotEngine.layoutFor(zone);
    if (!layout) return null;

    const atGate = layout.entryPoints.includes(position);
    if (!atGate && !layout.memberPointNames.has(position)) return null;

    return {
      task,
      vehicle,
      cargo,
      zone,
      atGate,
      insideColumn: atGate ? null : columnIndexOfPoint(layout, position),
    };
  }

  private async commitCandidate(
    candidate: CommitCandidate,
    insideColumnByCargoId: ReadonlyMap<string, number>,
    taskByCargoId: ReadonlyMap<string, TransportTaskEntity>,
  ): Promise<void> {
    const result = await this.slotReservation.commit(
      candidate.cargo.id,
      candidate.zone,
      { allowSwap: candidate.atGate, insideColumnByCargoId },
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
    if (!result.keptOwnReservation) {
      await this.dropoffOrder.reissue(task, vehicle, result.slot);
    }

    this.logger.log(
      `Task ${task.id}: ${vehicle} committed ${result.slot}${
        candidate.atGate ? '' : ' (already inside the zone, no swap)'
      }${result.keptOwnReservation ? '' : ' — re-aimed'}`,
    );

    if (!result.displaced) return;
    await this.reaimDisplaced(result, vehicle, taskByCargoId);
  }

  private async reaimDisplaced(
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

    await this.dropoffOrder.reissue(
      victim,
      victimVehicle,
      displaced.replacementSlot,
    );
    victim.metadata = {
      ...victim.metadata,
      swapCount: (victim.metadata?.swapCount ?? 0) + 1,
    };
    await this.taskRepo.save(victim);
    this.logger.log(
      `Task ${victim.id}: ${victimVehicle} lost ${displaced.lostSlot} to ${winner}, re-aimed at ${displaced.replacementSlot}`,
    );
  }

  private async acquireSingleRunnerLock(): Promise<{
    release: () => Promise<void>;
  } | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const [{ locked }] = (await runner.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [SINGLE_RUNNER_LOCK_KEY],
    )) as { locked: boolean }[];
    if (!locked) {
      await runner.release();
      return null;
    }
    return {
      release: async () => {
        await runner.query('SELECT pg_advisory_unlock($1)', [
          SINGLE_RUNNER_LOCK_KEY,
        ]);
        await runner.release();
      },
    };
  }
}

function insideColumnMap(
  candidates: readonly CommitCandidate[],
): ReadonlyMap<string, number> {
  const byCargoId = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.insideColumn === null) continue;
    byCargoId.set(candidate.cargo.id, candidate.insideColumn);
  }
  return byCargoId;
}

function gateFirst(candidates: readonly CommitCandidate[]): CommitCandidate[] {
  return [...candidates].sort((a, b) => Number(b.atGate) - Number(a.atGate));
}

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

const TICK_MS = 500;
const SINGLE_RUNNER_LOCK_KEY = 815_004_711;

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
      for (const task of await this.tasksAwaitingCommit()) {
        await this.advance(task);
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
    });
  }

  private async advance(task: TransportTaskEntity): Promise<void> {
    const vehicle = task.metadata?.assignedVehicleName;
    const position = vehicle
      ? this.vehicleStore.get(vehicle)?.currentPosition
      : null;
    if (!vehicle || !position) return;

    const cargo = await this.cargoRepo.findOne({
      where: { id: task.cargoId!, status: In([CargoStatus.ACTIVE]) },
    });
    if (!cargo || cargo.destinationLocationName || !cargo.destinationZoneId) {
      return;
    }

    const zone = await this.zoneRepo.findOne({
      where: { id: cargo.destinationZoneId },
      relations: { members: true },
    });
    if (!zone) return;

    const layout = await this.deliverySlotEngine.layoutFor(zone);
    if (!layout) return;

    const atGate = layout.entryPoints.includes(position);
    const past = layout.memberPointNames.has(position);
    if (!atGate && !past) return;

    const result = await this.slotReservation.commit(cargo.id, zone, atGate);
    if (!result) return;

    await this.applyCommit(task, vehicle, result, atGate);
  }

  private async applyCommit(
    task: TransportTaskEntity,
    vehicle: string,
    result: SlotCommitResult,
    swappable: boolean,
  ): Promise<void> {
    if (!result.keptOwnReservation) {
      await this.dropoffOrder.reissue(task, vehicle, result.slot);
    }

    this.logger.log(
      `Task ${task.id}: ${vehicle} committed ${result.slot}${
        swappable ? '' : ' (already inside the zone, no swap)'
      }${result.keptOwnReservation ? '' : ' — re-aimed'}`,
    );

    if (!result.displaced) return;
    await this.reaimDisplaced(result, vehicle);
  }

  private async reaimDisplaced(
    result: SlotCommitResult,
    winner: string,
  ): Promise<void> {
    const displaced = result.displaced!;
    const victim = await this.taskRepo.findOne({
      where: { cargoId: displaced.cargoId, status: TaskStatus.DELIVERING },
    });
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

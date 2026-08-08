import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { ZoneMemberEntity } from '../zones/entities/zone-member.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { TransportTaskService } from './transport-task.service';
import { ZoneGeometryService, MemberAxes } from './zone-geometry.service';
import {
  allocationReachesPoints,
  isDeeperInSameLane,
  LaneSlot,
} from './domain/lane-safety.policy';

interface LaneIndex {
  memberSignature: string;
  axesByLocation: Map<string, MemberAxes>;
  pointsByLane: Map<number, Set<string>>;
}

interface DeeperPickup {
  task: TransportTaskEntity;
  cargo: CargoEntity;
}

function memberSignature(members: readonly ZoneMemberEntity[]): string {
  return members
    .map((member) => member.locationName)
    .sort()
    .join('|');
}

/**
 * Keeps a pickup lane safe to add cargo to (ARCHITECTURE §6.3).
 *
 * An AGV cannot drive through a row, so putting a box in a shallow slot while a
 * vehicle is already ordered to a deeper slot of the same lane would trap that
 * vehicle. Called from the create-cargo use case: it either clears the lane by
 * preempting the deeper pickups, or refuses the placement when a vehicle has
 * already been granted resources inside the lane and can no longer be halted
 * outside it.
 */
@Injectable()
export class LaneSafetyService {
  private readonly logger = new Logger(LaneSafetyService.name);
  private readonly laneIndexByZone = new Map<string, LaneIndex>();

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    private readonly zoneGeometry: ZoneGeometryService,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly transportTask: TransportTaskService,
  ) {}

  async clearLaneForNewCargo(
    sourceZoneId: string,
    pickupLocationName: string,
  ): Promise<void> {
    const zone = await this.zoneRepo.findOne({ where: { id: sourceZoneId } });
    if (!zone) return;

    const laneIndex = await this.laneIndexOf(zone);
    const newSlot = laneIndex?.axesByLocation.get(pickupLocationName);
    if (!laneIndex || !newSlot) return;

    const deeperPickups = await this.findDeeperPickups(
      sourceZoneId,
      newSlot,
      laneIndex.axesByLocation,
    );
    if (deeperPickups.length === 0) return;

    const committed = await this.committedInsideLane(
      deeperPickups.map((pickup) => pickup.task),
    );

    for (const { task, cargo } of deeperPickups) {
      if (!committed.has(task.id)) continue;
      throw new BadRequestException(
        `Không đủ an toàn để tạo hàng tại vị trí này: xe ${task.metadata?.assignedVehicleName} đã được lệnh vào dãy này để lấy hàng tại ${cargo.sourcePointName ?? cargo.sourcePickupLocationName}.`,
      );
    }

    for (const { task } of deeperPickups) {
      await this.preempt(task, pickupLocationName);
    }
  }

  async committedInsideLane(
    tasks: readonly TransportTaskEntity[],
  ): Promise<Set<string>> {
    const committed = new Set<string>();
    if (tasks.length === 0) return committed;

    const cargoById = await this.cargoesOf(tasks);
    const allocatedByVehicle = await this.readAllocatedResources(
      vehicleNamesOf(tasks),
    );

    const byZone = new Map<string, DeeperPickup[]>();
    for (const task of tasks) {
      const cargo = task.cargoId ? cargoById.get(task.cargoId) : undefined;
      if (!task.metadata?.assignedVehicleName) continue;
      if (!cargo?.sourceZoneId || !cargo.sourcePickupLocationName) continue;
      const entries = byZone.get(cargo.sourceZoneId) ?? [];
      entries.push({ task, cargo });
      byZone.set(cargo.sourceZoneId, entries);
    }

    for (const [zoneId, entries] of byZone) {
      const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
      const laneIndex = zone ? await this.laneIndexOf(zone) : null;
      if (!laneIndex) continue;

      for (const { task, cargo } of entries) {
        const slot = laneIndex.axesByLocation.get(
          cargo.sourcePickupLocationName as string,
        );
        if (!slot) continue;
        const lanePoints =
          laneIndex.pointsByLane.get(slot.laneKey) ?? new Set<string>();
        const allocated =
          allocatedByVehicle.get(
            task.metadata?.assignedVehicleName as string,
          ) ?? [];
        if (allocationReachesPoints(allocated, lanePoints)) {
          committed.add(task.id);
        }
      }
    }
    return committed;
  }

  private async cargoesOf(
    tasks: readonly TransportTaskEntity[],
  ): Promise<Map<string, CargoEntity>> {
    const cargoIds = tasks
      .map((task) => task.cargoId)
      .filter((id): id is string => id !== null);
    if (cargoIds.length === 0) return new Map();
    const cargos = await this.cargoRepo.find({ where: { id: In(cargoIds) } });
    return new Map(cargos.map((cargo) => [cargo.id, cargo]));
  }

  private async preempt(
    task: TransportTaskEntity,
    newCargoLocationName: string,
  ): Promise<void> {
    const to1Name = task.metadata?.to1Name;
    const vehicleName = task.metadata?.assignedVehicleName ?? null;
    const reason = `Preempted by new cargo at ${newCargoLocationName} (closer to the aisle in the same lane)`;

    if (to1Name) {
      await this.kernelApi.withdrawTransportOrder(to1Name, false);
    }

    task.metadata = {
      ...task.metadata,
      blockedReason: reason,
      to1Name: undefined,
      assignedVehicleName: undefined,
    };
    task.assignedAt = null;
    task.startedAt = null;
    await this.transportTask.changeStatus(task, TaskStatus.BLOCKED, {
      trigger: 'CARGO_CREATE',
      reason,
      vehicleName,
      context: { preempted: true, withdrawnOrder: to1Name ?? null },
    });
    this.logger.log(`Task ${task.id} PREEMPTED → BLOCKED (${reason})`);
  }

  private async findDeeperPickups(
    sourceZoneId: string,
    newSlot: LaneSlot,
    axesByLocation: Map<string, MemberAxes>,
  ): Promise<DeeperPickup[]> {
    const cargos = await this.cargoRepo.find({
      where: { sourceZoneId, status: CargoStatus.ACTIVE },
    });

    const deeperCargoById = new Map<string, CargoEntity>();
    for (const cargo of cargos) {
      const slot = cargo.sourcePickupLocationName
        ? axesByLocation.get(cargo.sourcePickupLocationName)
        : undefined;
      if (slot && isDeeperInSameLane(slot, newSlot)) {
        deeperCargoById.set(cargo.id, cargo);
      }
    }
    if (deeperCargoById.size === 0) return [];

    const tasks = await this.taskRepo.find({
      where: {
        cargoId: In([...deeperCargoById.keys()]),
        status: TaskStatus.PICKING_UP,
      },
    });

    return tasks.flatMap((task) => {
      const cargo = task.cargoId
        ? deeperCargoById.get(task.cargoId)
        : undefined;
      return cargo ? [{ task, cargo }] : [];
    });
  }

  private async readAllocatedResources(
    vehicleNames: readonly string[],
  ): Promise<Map<string, string[][]>> {
    if (!this.vehicleStore.isConnected()) {
      const states = await this.kernelApi.getVehicleStates();
      return new Map(
        states.map((state) => [state.name, state.allocatedResources ?? []]),
      );
    }
    return new Map(
      vehicleNames.map((name) => [
        name,
        this.vehicleStore.get(name)?.allocatedResources ?? [],
      ]),
    );
  }

  private async laneIndexOf(zone: ZoneEntity): Promise<LaneIndex | null> {
    const signature = memberSignature(zone.members ?? []);
    const cached = this.laneIndexByZone.get(zone.id);
    if (cached && cached.memberSignature === signature) return cached;

    const axesByLocation = await this.zoneGeometry.computeMemberAxes(zone);
    if (!axesByLocation) return null;

    const pointNamesByLocation = await this.kernelApi.getPointNamesByLocation();
    const pointsByLane = new Map<number, Set<string>>();
    for (const [locationName, axes] of axesByLocation) {
      const points = pointsByLane.get(axes.laneKey) ?? new Set<string>();
      for (const point of pointNamesByLocation.get(locationName) ?? []) {
        points.add(point);
      }
      pointsByLane.set(axes.laneKey, points);
    }

    const index: LaneIndex = {
      memberSignature: signature,
      axesByLocation,
      pointsByLane,
    };
    this.laneIndexByZone.set(zone.id, index);
    return index;
  }
}

function vehicleNamesOf(tasks: readonly TransportTaskEntity[]): string[] {
  return tasks
    .map((task) => task.metadata?.assignedVehicleName)
    .filter((name): name is string => typeof name === 'string');
}

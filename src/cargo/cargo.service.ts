import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { TransportTaskStateMachine } from './domain/transport-task.state-machine';
import {
  ZoneEntity,
  ZoneStatus,
  ZoneType,
} from '../zones/entities/zone.entity';
import type {
  CargoResponseDto,
  CargoVisualDto,
  CreateCargoDto,
  ListCargosQueryDto,
} from './cargo.dto';

@Injectable()
export class CargoService {
  constructor(
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
  ) {}

  async create(dto: CreateCargoDto, userId: string): Promise<CargoEntity> {
    const pickupLocationName = await this.kernelApi.findPickupLocationForPoint(
      dto.sourcePointName,
    );
    if (!pickupLocationName) {
      throw new BadRequestException(
        `Point "${dto.sourcePointName}" is invalid or is not linked to a PICKUP location.`,
      );
    }

    const occupiedSource = await this.cargoRepo.findOne({
      where: {
        sourcePointName: dto.sourcePointName,
        status: CargoStatus.ACTIVE,
      },
    });
    if (occupiedSource) {
      throw new BadRequestException(
        `Point "${dto.sourcePointName}" already has cargo waiting for transport (${occupiedSource.itemCode}).`,
      );
    }

    const zone = await this.zoneRepo.findOne({
      where: {
        id: dto.destinationZoneId,
        type: ZoneType.DROPOFF,
        status: ZoneStatus.ACTIVE,
      },
      relations: { members: true },
    });
    if (!zone) {
      throw new BadRequestException(
        'Khu trả hàng không tồn tại hoặc không hoạt động.',
      );
    }

    // Pickup zone the source belongs to (if any) — drives the row-dependency
    // rule at release time. Null when the source point isn't in a PICKUP zone.
    const sourceZoneId = await this.resolvePickupZoneId(pickupLocationName);

    // Reserve a *seat* (capacity) in the drop-off zone now, but defer choosing
    // the concrete slot to the TO2 barrier (TransportTaskSaga.commitDropoffSlot),
    // when occupancy reflects the vehicle's actual arrival — required for correct
    // fill order on one-way lanes. A reserved cargo has destinationZoneId set and
    // destinationLocationName still null.
    //
    // The capacity check + insert run under the SAME per-zone advisory lock as
    // the barrier commit, so concurrent requests can't both pass the check and
    // over-admit past the zone's capacity.
    const { saved, task } = await this.dataSource.transaction(
      async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
          [zone.id],
        );
        const cargoRepo = manager.getRepository(CargoEntity);
        const occupied = await cargoRepo.count({
          where: {
            destinationZoneId: zone.id,
            status: In([CargoStatus.ACTIVE, CargoStatus.DELIVERED]),
          },
        });
        if (occupied >= zone.members.length) {
          throw new BadRequestException(
            'Khu trả hàng đã đầy, không còn vị trí trống.',
          );
        }

        const saved = await cargoRepo.save(
          cargoRepo.create({
            itemCode:
              dto.itemCode ?? `ITEM-${Date.now().toString(36).toUpperCase()}`,
            sourcePointName: dto.sourcePointName,
            sourcePickupLocationName: pickupLocationName,
            destinationZoneId: zone.id,
            destinationLocationName: null,
            sourceZoneId,
            status: CargoStatus.ACTIVE,
            createdBy: userId,
          }),
        );

        const requestCode = `TR-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`;
        const task = await manager.getRepository(TransportTaskEntity).save(
          manager.getRepository(TransportTaskEntity).create({
            requestCode,
            cargoId: saved.id,
            status: TaskStatus.CREATED,
            metadata: {
              approachLocationName: zone.approachLocationName ?? undefined,
            },
          }),
        );

        return { saved, task };
      },
    );

    // Emit after commit so dispatch listeners see the persisted task/cargo.
    this.transportTask.publishCreated(task);

    return saved;
  }

  async list(query: ListCargosQueryDto = {}): Promise<CargoResponseDto[]> {
    const where = query.status ? { status: query.status as CargoStatus } : {};
    const cargos = await this.cargoRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return this.enrichCargos(cargos);
  }

  async findOne(id: string): Promise<CargoResponseDto> {
    const cargo = await this.cargoRepo.findOne({ where: { id } });
    if (!cargo) {
      throw new NotFoundException('Cargo not found.');
    }

    const [mapped] = await this.enrichCargos([cargo]);
    return mapped;
  }

  async remove(id: string): Promise<{ message: string }> {
    const cargo = await this.cargoRepo.findOne({ where: { id } });
    if (!cargo) throw new NotFoundException('Cargo not found.');

    const task = await this.taskRepo.findOne({ where: { cargoId: id } });

    if (task) {
      if (task.status === TaskStatus.DELIVERING) {
        throw new BadRequestException(
          'Cannot delete cargo: the AGV is currently carrying this item to its destination.',
        );
      }

      if (task.status === TaskStatus.PICKING_UP) {
        const toName = task.metadata?.to1Name;
        if (toName) {
          await this.kernelApi.withdrawTransportOrder(toName);
        }
      }

      if (TransportTaskStateMachine.isCancellable(task.status)) {
        task.cancelledAt = new Date();
        await this.transportTask.changeStatus(task, TaskStatus.CANCELLED, {
          trigger: 'API',
          reason: 'cargo deleted',
        });
      }
    }

    await this.cargoRepo.softDelete(id);
    return { message: 'Cargo deleted.' };
  }

  async getTaskByCargo(cargoId: string): Promise<TransportTaskEntity | null> {
    return this.taskRepo.findOne({ where: { cargoId } });
  }

  /** The active PICKUP zone whose members include this pickup location, if any. */
  private async resolvePickupZoneId(
    pickupLocationName: string,
  ): Promise<string | null> {
    const zone = await this.zoneRepo
      .createQueryBuilder('z')
      .innerJoin('z.members', 'm', 'm.locationName = :loc', {
        loc: pickupLocationName,
      })
      .where('z.type = :type', { type: ZoneType.PICKUP })
      .andWhere('z.status = :status', { status: ZoneStatus.ACTIVE })
      .getOne();
    return zone?.id ?? null;
  }

  private async enrichCargos(
    cargos: CargoEntity[],
  ): Promise<CargoResponseDto[]> {
    if (cargos.length === 0) return [];

    const destinationPointEntries = await Promise.all(
      cargos.map(
        async (cargo) =>
          [
            cargo.id,
            cargo.destinationLocationName
              ? await this.kernelApi.findPointForLocation(
                  cargo.destinationLocationName,
                )
              : null,
          ] as const,
      ),
    );
    const destinationPointByCargoId = new Map(destinationPointEntries);

    const tasks = await this.taskRepo.find({
      where: { cargoId: In(cargos.map((cargo) => cargo.id)) },
      order: { createdAt: 'DESC' },
    });

    const taskByCargoId = new Map<string, TransportTaskEntity>();
    for (const task of tasks) {
      if (task.cargoId && !taskByCargoId.has(task.cargoId)) {
        taskByCargoId.set(task.cargoId, task);
      }
    }

    return cargos.map((cargo) => {
      const task = taskByCargoId.get(cargo.id) ?? null;
      return {
        id: cargo.id,
        itemCode: cargo.itemCode,
        sourcePointName: cargo.sourcePointName,
        sourcePickupLocationName: cargo.sourcePickupLocationName,
        destinationLocationName: cargo.destinationLocationName,
        status: cargo.status,
        createdBy: cargo.createdBy,
        createdAt: cargo.createdAt,
        updatedAt: cargo.updatedAt,
        deletedAt: cargo.deletedAt,
        taskStatus: task?.status ?? null,
        assignedVehicleName: task?.metadata.assignedVehicleName ?? null,
        visual: this.resolveVisual(
          cargo,
          task,
          destinationPointByCargoId.get(cargo.id) ?? null,
        ),
      };
    });
  }

  private resolveVisual(
    cargo: CargoEntity,
    task: TransportTaskEntity | null,
    destinationPointName: string | null,
  ): CargoVisualDto {
    if (task?.status === TaskStatus.DELIVERING) {
      return {
        state: 'ON_AGV',
        pointName: null,
        vehicleName: task.metadata.assignedVehicleName ?? null,
      };
    }

    if (
      task?.status === TaskStatus.DELIVERY_COMPLETED ||
      cargo.status === CargoStatus.DELIVERED
    ) {
      return {
        state: 'AT_DESTINATION',
        pointName: destinationPointName ?? cargo.destinationLocationName,
        vehicleName: null,
      };
    }

    return {
      state: 'AT_SOURCE',
      pointName: cargo.sourcePointName,
      vehicleName: null,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { CargoEntity, CargoStatus } from './entities/cargo.entity';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { TaskStatusTransitionEntity } from './entities/task-status-transition.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { TransportTaskService } from './transport-task.service';
import { LaneSafetyService } from './lane-safety.service';
import { TransportTaskStateMachine } from './domain/transport-task.state-machine';
import type { DispatchMatcher } from './domain/dispatch.policy';
import {
  ZoneEntity,
  ZoneStatus,
  ZoneType,
} from '../zones/entities/zone.entity';
import type {
  CargoAssignmentDecisionDto,
  CargoListResponse,
  CargoResponseDto,
  CargoVisualDto,
  CreateCargoDto,
  ListCargosQueryDto,
} from './cargo.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const ASSIGNMENT_TRIGGER = 'ASSIGNMENT_ENGINE';

const SEARCHABLE_COLUMNS = [
  'cargo.itemCode',
  'cargo.sourcePointName',
  'cargo.destinationLocationName',
];

const NEWEST_TASK_HAS_STATUS = `EXISTS (
  SELECT 1
  FROM transport_requests candidate
  WHERE candidate.cargo_id = cargo.id
    AND candidate.status = :taskStatus
    AND candidate.created_at = (
      SELECT MAX(any_task.created_at)
      FROM transport_requests any_task
      WHERE any_task.cargo_id = cargo.id
    )
)`;

function readFiniteNumber(
  context: Record<string, unknown>,
  key: string,
): number | null {
  const value = context[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonEmptyString(
  context: Record<string, unknown>,
  key: string,
): string | null {
  const value = context[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readMatcher(context: Record<string, unknown>): DispatchMatcher | null {
  const matcher = context.matcher;
  return matcher === 'hungarian' || matcher === 'greedy' ? matcher : null;
}

function otherMatcher(matcher: DispatchMatcher): DispatchMatcher {
  return matcher === 'greedy' ? 'hungarian' : 'greedy';
}

function toAssignmentDecision(
  cargoId: string,
  taskId: string,
  transition: TaskStatusTransitionEntity,
): CargoAssignmentDecisionDto {
  const context = transition.context ?? {};
  const matcher = readMatcher(context);
  const alternativeVehicleName = readNonEmptyString(context, 'altVehicleName');

  return {
    cargoId,
    taskId,
    decidedAt: transition.occurredAt,
    vehicleName: transition.vehicleName,
    matcher,
    matchedRequestCount: readFiniteNumber(context, 'batchSize'),
    distanceToSource: readFiniteNumber(context, 'distanceToSource'),
    approachDistance: readFiniteNumber(context, 'approachDistance'),
    alternative:
      matcher && alternativeVehicleName
        ? {
            matcher: otherMatcher(matcher),
            vehicleName: alternativeVehicleName,
            distanceToSource: readFiniteNumber(context, 'altDistanceToSource'),
          }
        : null,
  };
}

@Injectable()
export class CargoService {
  constructor(
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(TaskStatusTransitionEntity)
    private readonly transitionRepo: Repository<TaskStatusTransitionEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly kernelApi: KernelApiService,
    private readonly transportTask: TransportTaskService,
    private readonly laneSafety: LaneSafetyService,
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

    const sourceZoneId = await this.resolvePickupZoneId(pickupLocationName);

    await this.assertZoneHasRoom(this.cargoRepo, zone);

    if (sourceZoneId) {
      await this.laneSafety.clearLaneForNewCargo(
        sourceZoneId,
        pickupLocationName,
      );
    }

    const { saved, task } = await this.dataSource.transaction(
      async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
          [zone.id],
        );
        const cargoRepo = manager.getRepository(CargoEntity);
        await this.assertZoneHasRoom(cargoRepo, zone);

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
            metadata: {},
          }),
        );

        return { saved, task };
      },
    );

    // Emit after commit so dispatch listeners see the persisted task/cargo.
    this.transportTask.publishCreated(task);

    return saved;
  }

  async list(query: ListCargosQueryDto = {}): Promise<CargoListResponse> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const [cargos, total] = await this.buildListQuery(query)
      .orderBy('cargo.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { cargos: await this.enrichCargos(cargos), total, page, limit };
  }

  async getAssignmentDecision(
    cargoId: string,
  ): Promise<CargoAssignmentDecisionDto> {
    const cargo = await this.cargoRepo.findOne({ where: { id: cargoId } });
    if (!cargo) throw new NotFoundException('Cargo not found.');

    const task = await this.taskRepo.findOne({
      where: { cargoId },
      order: { createdAt: 'DESC' },
    });
    if (!task) {
      throw new NotFoundException('Cargo has no transport request yet.');
    }

    const transition = await this.transitionRepo.findOne({
      where: {
        taskId: task.id,
        trigger: ASSIGNMENT_TRIGGER,
        toStatus: TaskStatus.PICKING_UP,
      },
      order: { occurredAt: 'DESC', id: 'DESC' },
    });
    if (!transition) {
      throw new NotFoundException(
        'This request has not been assigned to a vehicle yet.',
      );
    }

    return toAssignmentDecision(cargo.id, task.id, transition);
  }

  private buildListQuery(
    query: ListCargosQueryDto,
  ): SelectQueryBuilder<CargoEntity> {
    const builder = this.cargoRepo.createQueryBuilder('cargo');

    if (query.status) {
      builder.andWhere('cargo.status = :status', {
        status: query.status as CargoStatus,
      });
    }

    const search = query.search?.trim();
    if (search) {
      const matches = SEARCHABLE_COLUMNS.map(
        (column) => `${column} ILIKE :search`,
      ).join(' OR ');
      builder.andWhere(`(${matches})`, { search: `%${search}%` });
    }

    if (query.taskStatus) {
      builder.andWhere(NEWEST_TASK_HAS_STATUS, {
        taskStatus: query.taskStatus,
      });
    }

    return builder;
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

  private async assertZoneHasRoom(
    cargoRepo: Repository<CargoEntity>,
    zone: ZoneEntity,
  ): Promise<void> {
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
  }

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
        blockedReason: task?.metadata.blockedReason ?? null,
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
    const unloaded = Boolean(task?.metadata?.unloadedAt);

    if (task?.status === TaskStatus.DELIVERING && !unloaded) {
      return {
        state: 'ON_AGV',
        pointName: null,
        vehicleName: task.metadata.assignedVehicleName ?? null,
      };
    }

    if (
      unloaded ||
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

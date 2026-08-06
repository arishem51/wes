import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AgvEntity } from './entities/agv.entity';
import {
  VehicleErrorEventEntity,
  VehicleErrorEventKind,
} from './entities/vehicle-error-event.entity';
import { VehicleStateTransitionEntity } from '../opentcs/entities/vehicle-state-transition.entity';
import { CargoEntity } from '../cargo/entities/cargo.entity';
import {
  TaskStatus,
  TransportTaskEntity,
} from '../cargo/entities/transport-task.entity';
import { toAgvErrorEventDto, toAgvStateChangeDto } from './agvs.mapper';
import {
  AgvErrorFrequencyEntry,
  AgvErrorFrequencyQueryDto,
  AgvErrorFrequencyResponse,
  AgvErrorHistoryResponse,
  AgvErrorWindow,
  AgvHistoryQueryDto,
  AgvStateLogResponse,
  AgvTaskHistoryEntryDto,
  AgvTaskHistoryQueryDto,
  AgvTaskHistoryResponse,
  DEFAULT_AGV_ERROR_WINDOW,
} from './dto/agvs.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_ERROR_FREQUENCY_LIMIT = 20;

const ASSIGNED_VEHICLE_EXPRESSION = `task.metadata ->> 'assignedVehicleName'`;

const WINDOW_HOURS: Record<AgvErrorWindow, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

const FAULT_KINDS: VehicleErrorEventKind[] = ['RAISED', 'CHANGED'];

interface ErrorFrequencyRow {
  vehicle_name: string;
  error_count: number;
  last_occurred_at: Date;
}

interface TaskHistoryRow {
  request_code: string;
  status: TaskStatus;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  source_point_name: string | null;
  destination_location_name: string | null;
}

function resolvePaging(query: AgvHistoryQueryDto) {
  const page = query.page ?? DEFAULT_PAGE;
  const limit = query.limit ?? DEFAULT_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
}

function windowStart(to: Date, window: AgvErrorWindow): Date {
  return new Date(to.getTime() - WINDOW_HOURS[window] * 60 * 60 * 1000);
}

function toTaskHistoryEntry(row: TaskHistoryRow): AgvTaskHistoryEntryDto {
  return {
    taskId: row.request_code,
    source: row.source_point_name,
    destination: row.destination_location_name,
    startedAt: row.started_at,
    endedAt: row.completed_at ?? row.cancelled_at,
    status: row.status,
  };
}

@Injectable()
export class AgvHistoryService {
  constructor(
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    @InjectRepository(VehicleStateTransitionEntity)
    private readonly transitionRepo: Repository<VehicleStateTransitionEntity>,
    @InjectRepository(VehicleErrorEventEntity)
    private readonly errorRepo: Repository<VehicleErrorEventEntity>,
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
  ) {}

  async taskHistory(
    id: string,
    query: AgvTaskHistoryQueryDto = {},
  ): Promise<AgvTaskHistoryResponse> {
    const agv = await this.requireAgv(id);
    const { page, limit, skip } = resolvePaging(query);

    const total = await this.taskHistoryFilter(agv.name, query).getCount();
    const rows = await this.taskHistoryFilter(agv.name, query)
      .withDeleted()
      .leftJoin(CargoEntity, 'cargo', 'cargo.id = task.cargoId')
      .select('task.requestCode', 'request_code')
      .addSelect('task.status', 'status')
      .addSelect('task.startedAt', 'started_at')
      .addSelect('task.completedAt', 'completed_at')
      .addSelect('task.cancelledAt', 'cancelled_at')
      .addSelect('cargo.sourcePointName', 'source_point_name')
      .addSelect('cargo.destinationLocationName', 'destination_location_name')
      .orderBy('task.createdAt', 'DESC')
      .addOrderBy('task.id', 'DESC')
      .offset(skip)
      .limit(limit)
      .getRawMany<TaskHistoryRow>();

    return {
      agvId: agv.id,
      vehicleName: agv.name,
      entries: rows.map(toTaskHistoryEntry),
      total,
      page,
      limit,
    };
  }

  async stateLog(
    id: string,
    query: AgvHistoryQueryDto = {},
  ): Promise<AgvStateLogResponse> {
    const agv = await this.requireAgv(id);
    const { page, limit, skip } = resolvePaging(query);

    const [transitions, total] = await this.transitionRepo.findAndCount({
      where: { vehicleName: agv.name },
      order: { occurredAt: 'DESC', id: 'DESC' },
      skip,
      take: limit,
    });

    return {
      agvId: agv.id,
      vehicleName: agv.name,
      entries: transitions.map(toAgvStateChangeDto),
      total,
      page,
      limit,
    };
  }

  async errorHistory(
    id: string,
    query: AgvHistoryQueryDto = {},
  ): Promise<AgvErrorHistoryResponse> {
    const agv = await this.requireAgv(id);
    const { page, limit, skip } = resolvePaging(query);

    const [events, total] = await this.errorRepo.findAndCount({
      where: { vehicleName: agv.name },
      order: { occurredAt: 'DESC', id: 'DESC' },
      skip,
      take: limit,
    });

    return {
      agvId: agv.id,
      vehicleName: agv.name,
      errors: events.map(toAgvErrorEventDto),
      total,
      page,
      limit,
    };
  }

  async errorFrequency(
    query: AgvErrorFrequencyQueryDto = {},
  ): Promise<AgvErrorFrequencyResponse> {
    const window = query.window ?? DEFAULT_AGV_ERROR_WINDOW;
    const limit = query.limit ?? DEFAULT_ERROR_FREQUENCY_LIMIT;
    const to = new Date();
    const from = windowStart(to, window);

    const rows = await this.errorRepo
      .createQueryBuilder('event')
      .select('event.vehicleName', 'vehicle_name')
      .addSelect('COUNT(*)::int', 'error_count')
      .addSelect('MAX(event.occurredAt)', 'last_occurred_at')
      .where('event.occurredAt >= :from', { from })
      .andWhere('event.occurredAt <= :to', { to })
      .andWhere('event.kind IN (:...kinds)', { kinds: FAULT_KINDS })
      .groupBy('event.vehicleName')
      .orderBy('error_count', 'DESC')
      .addOrderBy('last_occurred_at', 'DESC')
      .limit(limit)
      .getRawMany<ErrorFrequencyRow>();

    const agvIdByName = await this.agvIdByName();

    return {
      window,
      from,
      to,
      vehicles: rows.map((row) => this.toFrequencyEntry(row, agvIdByName)),
    };
  }

  private toFrequencyEntry(
    row: ErrorFrequencyRow,
    agvIdByName: Map<string, string>,
  ): AgvErrorFrequencyEntry {
    return {
      agvId: agvIdByName.get(row.vehicle_name) ?? null,
      vehicleName: row.vehicle_name,
      errorCount: Number(row.error_count),
      lastOccurredAt: row.last_occurred_at,
    };
  }

  private taskHistoryFilter(
    vehicleName: string,
    query: AgvTaskHistoryQueryDto,
  ): SelectQueryBuilder<TransportTaskEntity> {
    const builder = this.taskRepo
      .createQueryBuilder('task')
      .where(`${ASSIGNED_VEHICLE_EXPRESSION} = :vehicleName`, { vehicleName });

    if (query.from) {
      builder.andWhere('task.createdAt >= :from', {
        from: new Date(query.from),
      });
    }
    if (query.to) {
      builder.andWhere('task.createdAt <= :to', { to: new Date(query.to) });
    }
    return builder;
  }

  private async agvIdByName(): Promise<Map<string, string>> {
    const agvs = await this.agvRepo.find({
      select: { id: true, name: true },
    });
    return new Map(agvs.map((agv) => [agv.name, agv.id]));
  }

  private async requireAgv(id: string): Promise<AgvEntity> {
    const agv = await this.agvRepo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    return agv;
  }
}

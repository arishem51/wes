import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TaskStatus,
  TransportTaskEntity,
} from '../cargo/entities/transport-task.entity';
import { TaskStatusTransitionEntity } from '../cargo/entities/task-status-transition.entity';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import {
  BucketUnit,
  DEFAULT_KPI_WINDOW,
  KpiWindow,
  bucketUnitFor,
  failureRate,
  roundSeconds,
  successRate,
} from './domain/kpi';
import {
  FleetSnapshot,
  KpiResponse,
  QueueSnapshot,
  ThroughputPoint,
} from './dashboard.dto';

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

const RANGE_START_SQL: Record<KpiWindow, string> = {
  today: `date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`,
  '24h': `date_trunc('hour', now() AT TIME ZONE $1) AT TIME ZONE $1 - interval '23 hours'`,
  '7d': `date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 - interval '6 days'`,
};

const BUCKET_STEP: Record<BucketUnit, string> = {
  hour: '1 hour',
  day: '1 day',
};

const TERMINAL_STATUSES = [
  TaskStatus.DELIVERY_COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
];

const IN_FLIGHT_STATUSES = [
  TaskStatus.CREATED,
  TaskStatus.READY_TO_ASSIGN,
  TaskStatus.BLOCKED,
  TaskStatus.PICKING_UP,
  TaskStatus.DELIVERING,
];

interface RangeRow {
  range_start: Date;
  range_end: Date;
}

interface CountRow {
  status: string;
  total: number;
}

interface DurationRow {
  avg_transport_seconds: number | null;
  avg_assignment_wait_seconds: number | null;
}

interface ThroughputRow {
  bucket: Date;
  completed: number;
}

function totalsByStatus(rows: CountRow[]): (status: TaskStatus) => number {
  const totals = new Map(rows.map((row) => [row.status, row.total]));
  return (status) => totals.get(status) ?? 0;
}

@Injectable()
export class DashboardService {
  private readonly timezone: string;

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(TaskStatusTransitionEntity)
    private readonly transitionRepo: Repository<TaskStatusTransitionEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly vehicleStore: VehicleStateStore,
    config: ConfigService,
  ) {
    this.timezone = config.get<string>('KPI_TIMEZONE') ?? DEFAULT_TIMEZONE;
  }

  async kpis(window: KpiWindow = DEFAULT_KPI_WINDOW): Promise<KpiResponse> {
    const { range_start: from, range_end: to } =
      await this.resolveRange(window);
    const bucketUnit = bucketUnitFor(window);

    const [terminal, durations, throughput, queue, fleet] = await Promise.all([
      this.terminalCounts(from, to),
      this.durations(from, to),
      this.throughput(from, to, bucketUnit),
      this.queueSnapshot(),
      this.fleetSnapshot(),
    ]);

    return {
      window,
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      bucketUnit,
      completed: terminal.completed,
      failed: terminal.failed,
      cancelled: terminal.cancelled,
      failureRate: failureRate(terminal),
      successRate: successRate(terminal),
      avgTransportSeconds: roundSeconds(durations.avg_transport_seconds),
      avgAssignmentWaitSeconds: roundSeconds(
        durations.avg_assignment_wait_seconds,
      ),
      throughput,
      fleet,
      queue,
    };
  }

  private async resolveRange(window: KpiWindow): Promise<RangeRow> {
    const rows = await this.taskRepo.manager.query<RangeRow[]>(
      `SELECT ${RANGE_START_SQL[window]} AS range_start, now() AS range_end`,
      [this.timezone],
    );
    return rows[0];
  }

  private async terminalCounts(from: Date, to: Date) {
    const rows = await this.transitionRepo
      .createQueryBuilder('transition')
      .select('transition.toStatus', 'status')
      .addSelect('COUNT(*)::int', 'total')
      .where('transition.occurredAt >= :from', { from })
      .andWhere('transition.occurredAt <= :to', { to })
      .andWhere('transition.toStatus IN (:...statuses)', {
        statuses: TERMINAL_STATUSES,
      })
      .groupBy('transition.toStatus')
      .getRawMany<CountRow>();

    const totalOf = totalsByStatus(rows);

    return {
      completed: totalOf(TaskStatus.DELIVERY_COMPLETED),
      failed: totalOf(TaskStatus.FAILED),
      cancelled: totalOf(TaskStatus.CANCELLED),
    };
  }

  private async durations(from: Date, to: Date): Promise<DurationRow> {
    const row = (await this.taskRepo
      .createQueryBuilder('task')
      .select(
        `(AVG(EXTRACT(EPOCH FROM (task.completed_at - task.started_at)))
            FILTER (WHERE task.completed_at BETWEEN :from AND :to
                      AND task.started_at IS NOT NULL))::float8`,
        'avg_transport_seconds',
      )
      .addSelect(
        `(AVG(EXTRACT(EPOCH FROM (task.assigned_at - task.created_at)))
            FILTER (WHERE task.assigned_at BETWEEN :from AND :to))::float8`,
        'avg_assignment_wait_seconds',
      )
      .setParameters({ from, to })
      .getRawOne()) as DurationRow;

    return row;
  }

  private async throughput(
    from: Date,
    to: Date,
    bucketUnit: BucketUnit,
  ): Promise<ThroughputPoint[]> {
    const rows = await this.taskRepo.manager.query<ThroughputRow[]>(
      `SELECT gs.bucket AS bucket, COALESCE(hits.total, 0)::int AS completed
         FROM generate_series($1::timestamptz, $2::timestamptz, $3::interval) AS gs(bucket)
         LEFT JOIN (
           SELECT (date_trunc($4::text, occurred_at AT TIME ZONE $5) AT TIME ZONE $5) AS bucket,
                  COUNT(*)::int AS total
             FROM task_status_transitions
            WHERE to_status = $6
              AND occurred_at >= $1
              AND occurred_at <= $2
            GROUP BY 1
         ) hits ON hits.bucket = gs.bucket
        ORDER BY gs.bucket`,
      [
        from,
        to,
        BUCKET_STEP[bucketUnit],
        bucketUnit,
        this.timezone,
        TaskStatus.DELIVERY_COMPLETED,
      ],
    );

    return rows.map((row) => ({
      bucket: new Date(row.bucket).toISOString(),
      completed: row.completed,
    }));
  }

  private async queueSnapshot(): Promise<QueueSnapshot> {
    const rows = await this.taskRepo
      .createQueryBuilder('task')
      .select('task.status', 'status')
      .addSelect('COUNT(*)::int', 'total')
      .where('task.status IN (:...statuses)', { statuses: IN_FLIGHT_STATUSES })
      .groupBy('task.status')
      .getRawMany<CountRow>();

    const totalOf = totalsByStatus(rows);

    const queue = {
      created: totalOf(TaskStatus.CREATED),
      readyToAssign: totalOf(TaskStatus.READY_TO_ASSIGN),
      blocked: totalOf(TaskStatus.BLOCKED),
      pickingUp: totalOf(TaskStatus.PICKING_UP),
      delivering: totalOf(TaskStatus.DELIVERING),
    };

    return {
      ...queue,
      inFlight: Object.values(queue).reduce((sum, count) => sum + count, 0),
    };
  }

  private async fleetSnapshot(): Promise<FleetSnapshot> {
    const registered = await this.agvRepo.count();
    const states = this.vehicleStore.getAll();

    return {
      registered,
      online: states.filter(
        (state) => state.state !== 'UNKNOWN' && state.state !== 'UNAVAILABLE',
      ).length,
      executing: states.filter(
        (state) => state.procState === 'PROCESSING_ORDER',
      ).length,
      charging: states.filter((state) => state.state === 'CHARGING').length,
      idle: states.filter(
        (state) =>
          state.state === 'IDLE' && state.procState !== 'PROCESSING_ORDER',
      ).length,
      error: states.filter((state) => state.state === 'ERROR').length,
      kernelConnected: this.vehicleStore.isConnected(),
    };
  }
}

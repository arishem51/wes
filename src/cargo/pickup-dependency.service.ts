import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TransportTaskEntity,
  TaskStatus,
} from './entities/transport-task.entity';
import { CargoEntity } from './entities/cargo.entity';
import { ZoneEntity } from '../zones/entities/zone.entity';
import { ZoneGeometryService, MemberAxes } from './zone-geometry.service';
import {
  countBlocked,
  findBlocker,
  PickupCandidate,
} from './domain/pickup-dependency.policy';

/** Statuses where the cargo is still physically sitting at its source point. */
const AT_SOURCE: readonly TaskStatus[] = [
  TaskStatus.CREATED,
  TaskStatus.READY_TO_ASSIGN,
  TaskStatus.BLOCKED,
  TaskStatus.PICKING_UP,
];

export interface PickupDecision {
  task: TransportTaskEntity;
  blocked: boolean;
  reason: string | null;
}

/**
 * Decides which pickup tasks are blocked by the "AGV can't drive through a
 * row" rule. Joins transport tasks with their cargo's source pickup zone,
 * ranks the zone's slots via ZoneGeometryService, and applies the pure
 * pickup-dependency policy per lane. Used by ReleaseEngine (evaluate all) and
 * AssignmentEngine (single-task guard at assign time).
 */
@Injectable()
export class PickupDependencyService {
  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    private readonly zoneGeometry: ZoneGeometryService,
  ) {}

  /** Evaluate every task whose cargo is still at its source point. */
  async evaluate(): Promise<PickupDecision[]> {
    const tasks = await this.taskRepo.find({
      where: { status: In(AT_SOURCE as TaskStatus[]) },
    });
    return this.decide(tasks);
  }

  /**
   * For every at-source task: how many other at-source pickups in the same
   * lane it is standing in front of. The system-derived urgency signal for
   * dispatch selection — a front-of-lane cargo unblocks its whole lane.
   */
  async blockingCounts(): Promise<Map<string, number>> {
    const tasks = await this.taskRepo.find({
      where: { status: In(AT_SOURCE as TaskStatus[]) },
    });
    const counts = new Map<string, number>();
    if (tasks.length === 0) return counts;

    const cargoIds = tasks
      .map((t) => t.cargoId)
      .filter((id): id is string => id !== null);
    const cargos = cargoIds.length
      ? await this.cargoRepo.find({ where: { id: In(cargoIds) } })
      : [];
    const cargoById = new Map(cargos.map((c) => [c.id, c]));

    const byZone = new Map<string, Array<{ taskId: string; loc: string }>>();
    for (const task of tasks) {
      const cargo = task.cargoId ? cargoById.get(task.cargoId) : undefined;
      const zoneId = cargo?.sourceZoneId ?? null;
      const loc = cargo?.sourcePickupLocationName ?? null;
      if (!zoneId || !loc) continue;
      const list = byZone.get(zoneId) ?? [];
      list.push({ taskId: task.id, loc });
      byZone.set(zoneId, list);
    }

    for (const [zoneId, entries] of byZone) {
      const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
      const geometry = zone
        ? await this.zoneGeometry.computeMemberAxes(zone)
        : null;
      if (!geometry) continue;

      const candidates: PickupCandidate[] = [];
      for (const e of entries) {
        const axes: MemberAxes | undefined = geometry.get(e.loc);
        if (!axes) continue;
        candidates.push({
          taskId: e.taskId,
          laneKey: axes.laneKey,
          depthKey: axes.depthKey,
          locationName: e.loc,
        });
      }
      for (const cand of candidates) {
        counts.set(cand.taskId, countBlocked(cand, candidates));
      }
    }
    return counts;
  }

  /** Re-check a single task right before assignment (closes release→assign race). */
  async isBlocked(task: TransportTaskEntity): Promise<boolean> {
    const cargo = task.cargoId
      ? await this.cargoRepo.findOne({ where: { id: task.cargoId } })
      : null;
    if (!cargo?.sourceZoneId) return false;

    const peers = await this.taskRepo
      .createQueryBuilder('t')
      .innerJoin(CargoEntity, 'c', 'c.id = t.cargo_id')
      .where('c.source_zone_id = :zoneId', { zoneId: cargo.sourceZoneId })
      .andWhere('t.status IN (:...statuses)', { statuses: AT_SOURCE })
      .getMany();

    const decisions = await this.decide(peers);
    return decisions.find((d) => d.task.id === task.id)?.blocked ?? false;
  }

  private async decide(
    tasks: TransportTaskEntity[],
  ): Promise<PickupDecision[]> {
    if (tasks.length === 0) return [];

    const cargoIds = tasks
      .map((t) => t.cargoId)
      .filter((id): id is string => id !== null);
    const cargos = cargoIds.length
      ? await this.cargoRepo.find({ where: { id: In(cargoIds) } })
      : [];
    const cargoById = new Map(cargos.map((c) => [c.id, c]));

    const byZone = new Map<
      string,
      Array<{ task: TransportTaskEntity; loc: string }>
    >();
    const decisions: PickupDecision[] = [];

    for (const task of tasks) {
      const cargo = task.cargoId ? cargoById.get(task.cargoId) : undefined;
      const zoneId = cargo?.sourceZoneId ?? null;
      const loc = cargo?.sourcePickupLocationName ?? null;
      // No pickup zone / location → no spatial constraint.
      if (!zoneId || !loc) {
        decisions.push({ task, blocked: false, reason: null });
        continue;
      }
      const list = byZone.get(zoneId) ?? [];
      list.push({ task, loc });
      byZone.set(zoneId, list);
    }

    for (const [zoneId, entries] of byZone) {
      const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
      const geometry = zone
        ? await this.zoneGeometry.computeMemberAxes(zone)
        : null;

      // Geometry unavailable → can't rank, treat all as unblocked.
      if (!geometry) {
        for (const e of entries) {
          decisions.push({ task: e.task, blocked: false, reason: null });
        }
        continue;
      }

      const candidates: PickupCandidate[] = [];
      const candByTask = new Map<string, PickupCandidate>();
      for (const e of entries) {
        const axes: MemberAxes | undefined = geometry.get(e.loc);
        if (!axes) continue;
        const cand: PickupCandidate = {
          taskId: e.task.id,
          laneKey: axes.laneKey,
          depthKey: axes.depthKey,
          locationName: e.loc,
        };
        candidates.push(cand);
        candByTask.set(e.task.id, cand);
      }

      for (const e of entries) {
        const cand = candByTask.get(e.task.id);
        if (!cand) {
          decisions.push({ task: e.task, blocked: false, reason: null });
          continue;
        }
        const blocker = findBlocker(cand, candidates);
        decisions.push({
          task: e.task,
          blocked: blocker !== null,
          reason: blocker
            ? `Blocked by cargo at ${blocker.locationName} (closer to the aisle in the same lane)`
            : null,
        });
      }
    }

    return decisions;
  }
}

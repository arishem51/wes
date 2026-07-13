import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DispatchPolicyEntity } from './entities/dispatch-policy.entity';
import { clampWeight } from './domain/dispatch-cost';

export interface ActiveDispatchWeights {
  readonly urgency: number;
  readonly battery: number;
}

export interface DispatchPolicyView {
  id: string;
  name: string;
  weightUrgency: number;
  weightProximity: number;
  weightInventoryPosition: number;
  weightBattery: number;
  maxAgvPerBlock: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DispatchPolicyInput {
  name?: string;
  weightUrgency?: number;
  weightProximity?: number;
  weightInventoryPosition?: number;
  weightBattery?: number;
}

@Injectable()
export class DispatchPolicyService {
  constructor(
    @InjectRepository(DispatchPolicyEntity)
    private readonly repo: Repository<DispatchPolicyEntity>,
  ) {}

  /**
   * Weights of the active policy, re-read on every call (one indexed findOne
   * per dispatch flush — no cross-process cache to go stale). Null when no
   * policy is active: callers take the pure-distance FIFO fast path.
   */
  async getActiveWeights(): Promise<ActiveDispatchWeights | null> {
    const active = await this.repo.findOne({
      where: { isActive: true },
      order: { updatedAt: 'DESC' },
    });
    if (!active) return null;
    return {
      urgency: clampWeight(active.weightUrgency),
      battery: clampWeight(active.weightBattery),
    };
  }

  async list(): Promise<DispatchPolicyView[]> {
    const rows = await this.repo.find({ order: { createdAt: 'ASC' } });
    return rows.map((row) => this.toView(row));
  }

  async create(
    input: DispatchPolicyInput & { name: string },
    createdBy: string | null,
  ): Promise<DispatchPolicyView> {
    const saved = await this.repo.save(
      this.repo.create({
        name: input.name,
        weightUrgency: input.weightUrgency ?? 1.0,
        weightProximity: input.weightProximity ?? 1.0,
        weightInventoryPosition: input.weightInventoryPosition ?? 1.0,
        weightBattery: input.weightBattery ?? 0,
        isActive: false,
        createdBy,
      }),
    );
    return this.toView(saved);
  }

  async update(id: string, input: DispatchPolicyInput): Promise<DispatchPolicyView> {
    const policy = await this.findOrThrow(id);
    if (input.name !== undefined) policy.name = input.name;
    if (input.weightUrgency !== undefined)
      policy.weightUrgency = input.weightUrgency;
    if (input.weightProximity !== undefined)
      policy.weightProximity = input.weightProximity;
    if (input.weightInventoryPosition !== undefined)
      policy.weightInventoryPosition = input.weightInventoryPosition;
    if (input.weightBattery !== undefined)
      policy.weightBattery = input.weightBattery;
    return this.toView(await this.repo.save(policy));
  }

  /**
   * Single-active invariant: deactivate every policy, then activate the target,
   * in one transaction; the partial unique index backstops concurrent races.
   * Takes effect on the next dispatch flush — no restart or cache bust needed.
   */
  async activate(id: string): Promise<DispatchPolicyView> {
    await this.findOrThrow(id);
    await this.repo.manager.transaction(async (manager) => {
      await manager.update(
        DispatchPolicyEntity,
        { isActive: true },
        { isActive: false },
      );
      await manager.update(DispatchPolicyEntity, { id }, { isActive: true });
    });
    return this.toView(await this.findOrThrow(id));
  }

  async deactivate(id: string): Promise<DispatchPolicyView> {
    const policy = await this.findOrThrow(id);
    policy.isActive = false;
    return this.toView(await this.repo.save(policy));
  }

  private async findOrThrow(id: string): Promise<DispatchPolicyEntity> {
    const policy = await this.repo.findOne({ where: { id } });
    if (!policy) throw new NotFoundException(`Dispatch policy ${id} not found`);
    return policy;
  }

  private toView(row: DispatchPolicyEntity): DispatchPolicyView {
    return {
      id: row.id,
      name: row.name,
      weightUrgency: row.weightUrgency,
      weightProximity: row.weightProximity,
      weightInventoryPosition: row.weightInventoryPosition,
      weightBattery: row.weightBattery,
      maxAgvPerBlock: row.maxAgvPerBlock,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { AgvEntity } from './entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type {
  AgvAcceptanceAction,
  AgvAcceptanceResponse,
  AgvAcceptanceResultDto,
  AgvDto,
  AgvListResponse,
  CreateAgvDto,
  ListAgvsQueryDto,
  SetAgvAcceptanceDto,
  UpdateAgvDto,
} from './dto/agvs.dto';
import { resolveKernelStatus, toAgvDto } from './agvs.mapper';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const IGNORED_USE_RESTORE = 'AGV đang bị bỏ qua — hãy dùng Khôi phục.';

function acceptanceBlocker(
  agv: AgvEntity,
  action: AgvAcceptanceAction,
): string | null {
  switch (action) {
    case 'enable':
      if (agv.isIgnored) return IGNORED_USE_RESTORE;
      return agv.isDispatchEnabled ? 'AGV đã ở trạng thái nhận việc.' : null;
    case 'disable':
      if (agv.isIgnored) return IGNORED_USE_RESTORE;
      return agv.isDispatchEnabled ? null : 'AGV đã ngừng nhận việc.';
    case 'ignore':
      return agv.isIgnored ? 'AGV đã bị bỏ qua.' : null;
    case 'restore':
      return agv.isIgnored ? null : 'AGV không ở trạng thái bỏ qua.';
  }
}

function isNoOp(agv: AgvEntity, action: AgvAcceptanceAction): boolean {
  switch (action) {
    case 'enable':
    case 'restore':
      return !agv.isIgnored && agv.isDispatchEnabled;
    case 'disable':
      return !agv.isIgnored && !agv.isDispatchEnabled;
    case 'ignore':
      return agv.isIgnored;
  }
}

@Injectable()
export class AgvsService {
  constructor(
    @InjectRepository(AgvEntity)
    private readonly repo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStateStore: VehicleStateStore,
  ) {}

  async list(query: ListAgvsQueryDto = {}): Promise<AgvListResponse> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const search = query.search?.trim();

    const where = search
      ? [{ code: ILike(`%${search}%`) }, { name: ILike(`%${search}%`) }]
      : undefined;

    const [agvs, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const kernelReachable = this.vehicleStateStore.isConnected();
    const kernelByName = new Map<string, KernelVehicleState>(
      this.vehicleStateStore.getAll().map((v) => [v.name, v]),
    );

    return {
      agvs: agvs.map((agv) =>
        toAgvDto(
          agv,
          resolveKernelStatus(kernelReachable, kernelByName.get(agv.name)),
        ),
      ),
      total,
      page,
      limit,
      kernelReachable,
    };
  }

  private toDto(agv: AgvEntity): AgvDto {
    const kernelReachable = this.vehicleStateStore.isConnected();
    const vehicle = this.vehicleStateStore.get(agv.name);
    return toAgvDto(agv, resolveKernelStatus(kernelReachable, vehicle));
  }

  async findOne(id: string): Promise<AgvDto> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    return this.toDto(agv);
  }

  async create(dto: CreateAgvDto, userId: string): Promise<AgvDto> {
    if (await this.repo.findOne({ where: { code: dto.code } })) {
      throw new ConflictException(`Code "${dto.code}" đã tồn tại.`);
    }
    if (await this.repo.findOne({ where: { name: dto.name } })) {
      throw new ConflictException(`AGV tên "${dto.name}" đã tồn tại.`);
    }

    const agv = this.repo.create({
      code: dto.code,
      name: dto.name,
      model: dto.model ?? null,
      manufacturer: dto.manufacturer ?? null,
      serialNumber: dto.serialNumber ?? null,
      isDispatchEnabled: dto.isDispatchEnabled ?? true,
      criticalBatteryThreshold: dto.criticalBatteryThreshold ?? 20,
      sufficientBatteryThreshold: dto.sufficientBatteryThreshold ?? 60,
      initialPosition: dto.initialPosition ?? null,
      config: dto.config ?? {},
      createdById: userId,
    });
    const saved = await this.repo.save(agv);
    return toAgvDto(saved, 'unknown');
  }

  async update(id: string, dto: UpdateAgvDto): Promise<AgvDto> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');

    if (dto.name && dto.name !== agv.name) {
      const existing = await this.repo.findOne({ where: { name: dto.name } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`AGV tên "${dto.name}" đã tồn tại.`);
      }
    }

    Object.assign(agv, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
      ...(dto.serialNumber !== undefined && { serialNumber: dto.serialNumber }),
      ...(dto.criticalBatteryThreshold !== undefined && {
        criticalBatteryThreshold: dto.criticalBatteryThreshold,
      }),
      ...(dto.sufficientBatteryThreshold !== undefined && {
        sufficientBatteryThreshold: dto.sufficientBatteryThreshold,
      }),
      ...(dto.initialPosition !== undefined && {
        initialPosition: dto.initialPosition,
      }),
      ...(dto.config !== undefined && { config: dto.config }),
    });

    const saved = await this.repo.save(agv);
    return toAgvDto(saved, 'unknown');
  }

  async connect(id: string): Promise<void> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    await this.kernelApi.setVehicleAdapterEnabled(agv.name, true);
    await this.kernelApi.setVehicleIntegrationLevel(agv.name, 'TO_BE_UTILIZED');
  }

  async disconnect(id: string): Promise<void> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    await this.kernelApi.setVehicleIntegrationLevel(agv.name, 'TO_BE_IGNORED');
    await this.kernelApi.setVehicleAdapterEnabled(agv.name, false);
  }

  enable(id: string): Promise<AgvDto> {
    return this.runAcceptance(id, 'enable');
  }

  disable(id: string): Promise<AgvDto> {
    return this.runAcceptance(id, 'disable');
  }

  ignore(id: string): Promise<AgvDto> {
    return this.runAcceptance(id, 'ignore');
  }

  restore(id: string): Promise<AgvDto> {
    return this.runAcceptance(id, 'restore');
  }

  async setAcceptance(
    dto: SetAgvAcceptanceDto,
  ): Promise<AgvAcceptanceResponse> {
    const results: AgvAcceptanceResultDto[] = [];
    for (const id of [...new Set(dto.ids)]) {
      results.push({ id, ...(await this.tryAcceptance(id, dto.action)) });
    }
    return { action: dto.action, results };
  }

  private async runAcceptance(
    id: string,
    action: AgvAcceptanceAction,
  ): Promise<AgvDto> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    const blocker = acceptanceBlocker(agv, action);
    if (blocker) throw new ConflictException(blocker);
    return this.toDto(await this.applyAcceptance(agv, action));
  }

  private async tryAcceptance(
    id: string,
    action: AgvAcceptanceAction,
  ): Promise<Omit<AgvAcceptanceResultDto, 'id'>> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) return { outcome: 'failed', reason: 'AGV không tồn tại.' };

    const blocker = acceptanceBlocker(agv, action);
    if (blocker) {
      return {
        outcome: isNoOp(agv, action) ? 'unchanged' : 'failed',
        reason: blocker,
      };
    }

    try {
      await this.applyAcceptance(agv, action);
      return { outcome: 'changed', reason: null };
    } catch (err) {
      return { outcome: 'failed', reason: (err as Error).message };
    }
  }

  private async applyAcceptance(
    agv: AgvEntity,
    action: AgvAcceptanceAction,
  ): Promise<AgvEntity> {
    if (action === 'ignore' || action === 'restore') {
      await this.kernelApi.setVehicleIntegrationLevel(
        agv.name,
        action === 'ignore' ? 'TO_BE_RESPECTED' : 'TO_BE_UTILIZED',
      );
    }
    if (action === 'enable') agv.isDispatchEnabled = true;
    if (action === 'disable') agv.isDispatchEnabled = false;
    if (action === 'ignore') agv.isIgnored = true;
    if (action === 'restore') {
      agv.isIgnored = false;
      agv.isDispatchEnabled = true;
    }
    return this.repo.save(agv);
  }

  async remove(id: string): Promise<void> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    await this.repo.remove(agv);
  }
}

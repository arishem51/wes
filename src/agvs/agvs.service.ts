import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { AgvEntity } from './entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type {
  AgvDto,
  AgvListResponse,
  CreateAgvDto,
  ListAgvsQueryDto,
  UpdateAgvDto,
} from './dto/agvs.dto';
import { resolveKernelStatus, toAgvDto } from './agvs.mapper';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

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
    const vehicle = this.vehicleStateStore
      .getAll()
      .find((v) => v.name === agv.name);
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

  async setPosition(id: string, pointName: string): Promise<void> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    await this.kernelApi.setVehiclePosition(agv.name, pointName);
  }

  async remove(id: string): Promise<void> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    await this.repo.remove(agv);
  }
}

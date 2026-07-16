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
  CreateAgvDto,
  ListAgvsQueryDto,
  UpdateAgvDto,
} from './dto/agvs.dto';

export type AgvKernelStatus =
  | 'connected'
  | 'reachable'
  | 'unreachable'
  | 'unknown';

export interface AgvDto {
  id: string;
  code: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  isDispatchEnabled: boolean;
  isIgnored: boolean;
  operationalBatteryThreshold: number;
  chargingBatteryThreshold: number;
  initialPosition: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  createdById: string | null;
  kernelStatus: AgvKernelStatus;
}

export interface AgvListResponse {
  agvs: AgvDto[];
  total: number;
  page: number;
  limit: number;
  kernelReachable: boolean;
}

function resolveKernelStatus(
  kernelReachable: boolean,
  vehicle: KernelVehicleState | undefined,
): AgvKernelStatus {
  if (!kernelReachable) return 'unknown';
  if (!vehicle) return 'unreachable';
  return vehicle.integrationLevel === 'TO_BE_UTILIZED'
    ? 'connected'
    : 'reachable';
}

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

    const kernelVehicles = this.vehicleStateStore.getAll();
    const kernelReachable = this.vehicleStateStore.isConnected();
    const kernelByName = new Map<string, KernelVehicleState>(
      kernelVehicles.map((v) => [v.name, v]),
    );

    const mappedAgvs: AgvDto[] = agvs.map((agv) => ({
      id: agv.id,
      code: agv.code,
      name: agv.name,
      model: agv.model,
      manufacturer: agv.manufacturer,
      serialNumber: agv.serialNumber,
      isDispatchEnabled: agv.isDispatchEnabled,
      isIgnored: agv.isIgnored,
      operationalBatteryThreshold: agv.operationalBatteryThreshold,
      chargingBatteryThreshold: agv.chargingBatteryThreshold,
      initialPosition: agv.initialPosition,
      config: agv.config,
      createdAt: agv.createdAt,
      createdById: agv.createdById,
      kernelStatus: resolveKernelStatus(
        kernelReachable,
        kernelByName.get(agv.name),
      ),
    }));

    return {
      agvs: mappedAgvs,
      total,
      page,
      limit,
      kernelReachable,
    };
  }

  async findOne(id: string): Promise<AgvDto> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');

    const kernelVehicles = this.vehicleStateStore.getAll();
    const kernelReachable = this.vehicleStateStore.isConnected();
    const kernelVehicle = kernelVehicles.find((v) => v.name === agv.name);

    return {
      ...agv,
      kernelStatus: resolveKernelStatus(kernelReachable, kernelVehicle),
    };
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
      operationalBatteryThreshold: dto.operationalBatteryThreshold ?? 20,
      chargingBatteryThreshold: dto.chargingBatteryThreshold ?? 10,
      initialPosition: dto.initialPosition ?? null,
      config: dto.config ?? {},
      createdById: userId,
    });
    const saved = await this.repo.save(agv);
    return { ...saved, kernelStatus: 'unknown' };
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
      ...(dto.operationalBatteryThreshold !== undefined && {
        operationalBatteryThreshold: dto.operationalBatteryThreshold,
      }),
      ...(dto.chargingBatteryThreshold !== undefined && {
        chargingBatteryThreshold: dto.chargingBatteryThreshold,
      }),
      ...(dto.initialPosition !== undefined && {
        initialPosition: dto.initialPosition,
      }),
      ...(dto.config !== undefined && { config: dto.config }),
    });

    const saved = await this.repo.save(agv);
    return { ...saved, kernelStatus: 'unknown' };
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

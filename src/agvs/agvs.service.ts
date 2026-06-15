import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgvEntity } from './entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { CreateAgvDto, RegisterAgvDto } from './dto/agvs.dto';

export type AgvKernelStatus = 'connected' | 'disconnected' | 'unknown';

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
  config: Record<string, unknown>;
  createdAt: Date;
  createdById: string | null;
  kernelStatus: AgvKernelStatus;
}

export interface AgvListResponse {
  agvs: AgvDto[];
  unregistered: { name: string }[];
  kernelReachable: boolean;
}

@Injectable()
export class AgvsService {
  constructor(
    @InjectRepository(AgvEntity)
    private readonly repo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
  ) {}

  async list(): Promise<AgvListResponse> {
    const [agvs, kernelVehicles] = await Promise.all([
      this.repo.find({ order: { createdAt: 'DESC' } }),
      this.kernelApi.getVehicles().catch(() => null),
    ]);

    const kernelReachable = kernelVehicles !== null;
    const kernelNames = new Set(kernelVehicles?.map((v) => v.name) ?? []);
    const wesNames = new Set(agvs.map((a) => a.name));

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
      config: agv.config,
      createdAt: agv.createdAt,
      createdById: agv.createdById,
      kernelStatus: kernelReachable
        ? kernelNames.has(agv.name)
          ? 'connected'
          : 'disconnected'
        : 'unknown',
    }));

    const unregistered = (kernelVehicles ?? [])
      .filter((v) => !wesNames.has(v.name))
      .map((v) => ({ name: v.name }));

    return { agvs: mappedAgvs, unregistered, kernelReachable };
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
      config: dto.config ?? {},
      createdById: userId,
    });
    const saved = await this.repo.save(agv);
    return { ...saved, kernelStatus: 'unknown' };
  }

  async register(dto: RegisterAgvDto, userId: string): Promise<AgvDto> {
    return this.create(
      {
        code: dto.name,
        name: dto.name,
        model: dto.model,
        manufacturer: dto.manufacturer,
        serialNumber: dto.serialNumber,
      },
      userId,
    );
  }

  async remove(id: string): Promise<void> {
    const agv = await this.repo.findOne({ where: { id } });
    if (!agv) throw new NotFoundException('AGV không tồn tại.');
    await this.repo.remove(agv);
  }
}

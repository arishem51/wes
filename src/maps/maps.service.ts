import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AxiosError } from 'axios';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { parseOpenTcsXml } from '../opentcs/map-loader/opentcs-xml.parser';
import { MapRecordEntity } from './entities/map-record.entity';

export type KernelMode = 'MODELLING' | 'OPERATING';

export interface KernelStatusDto {
  reachable: boolean;
  state: KernelMode | null;
}

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    @InjectRepository(MapRecordEntity)
    private readonly repo: Repository<MapRecordEntity>,
  ) {}

  async getKernelStatus(): Promise<KernelStatusDto> {
    const [reachable, state] = await Promise.all([
      this.kernelApi.isReachable(),
      this.kernelApi.getKernelState(),
    ]);
    return { reachable, state };
  }

  async setKernelState(state: KernelMode): Promise<KernelStatusDto> {
    try {
      await this.kernelApi.setKernelState(state);
    } catch (err) {
      const msg = (err as AxiosError).message;
      throw new ServiceUnavailableException(
        `Không thể chuyển chế độ kernel: ${msg}`,
      );
    }
    return this.getKernelStatus();
  }

  async getPlantModel(): Promise<unknown> {
    return this.kernelApi.getPlantModel();
  }

  async getKernelVehicles(): Promise<unknown[]> {
    return this.kernelApi.getVehicleStates();
  }

  async proxyKernelEvents(
    minSequenceNo: number,
    timeout: number,
  ): Promise<unknown> {
    return this.kernelApi.getEvents(minSequenceNo, timeout);
  }

  async getCurrent(): Promise<MapRecordEntity | null> {
    return this.repo.findOne({
      where: { isActive: true },
      order: { uploadedAt: 'DESC' },
    });
  }

  async upload(
    xmlBuffer: Buffer,
    originalFilename: string,
    uploadedById: string,
  ): Promise<MapRecordEntity> {
    const xmlContent = xmlBuffer.toString('utf-8');

    let model: ReturnType<typeof parseOpenTcsXml>;
    try {
      model = parseOpenTcsXml(xmlContent);
    } catch (err) {
      throw new BadRequestException(
        `File XML không hợp lệ: ${(err as Error).message}`,
      );
    }

    try {
      await this.kernelApi.putPlantModel(model);
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;
      const msg =
        status === 400 || status === 409
          ? `Kernel đang ở chế độ Vận hành, không thể cập nhật bản đồ. Hãy chuyển sang chế độ Thiết kế trước.`
          : `Không thể kết nối kernel: ${axiosErr.message}`;
      throw new ServiceUnavailableException(msg);
    }

    await this.repo.update({ isActive: true }, { isActive: false });

    const record = this.repo.create({
      name: model.name,
      originalFilename,
      pointCount: model.points.length,
      pathCount: model.paths.length,
      vehicleCount: model.vehicles.length,
      isActive: true,
      uploadedById,
    });
    return this.repo.save(record);
  }
}

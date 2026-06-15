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

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    @InjectRepository(MapRecordEntity)
    private readonly repo: Repository<MapRecordEntity>,
  ) {}

  async getKernelStatus(): Promise<{ reachable: boolean }> {
    const reachable = await this.kernelApi.isReachable();
    return { reachable };
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
          ? `Kernel từ chối plant model. Kernel cần ở chế độ Modelling để nhận bản đồ mới (hiện đang ở Operating). Hãy dùng KernelControlCenter để chuyển sang Modelling trước.`
          : `Không thể kết nối kernel: ${axiosErr.message}`;
      throw new ServiceUnavailableException(msg);
    }

    // Deactivate all previous records
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

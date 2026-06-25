import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AxiosError } from 'axios';
import {
  KernelApiService,
  KernelLocation,
  KernelLocationType,
} from '../opentcs/kernel-api.service';
import { parseOpenTcsXml } from '../opentcs/map-loader/opentcs-xml.parser';
import { savePlantModel } from '../opentcs/save-plant-model';
import { MapRecordEntity } from './entities/map-record.entity';
import { CargoEntity, CargoStatus } from '../cargo/entities/cargo.entity';

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
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
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

    if (state === 'OPERATING') {
      await this.kernelApi.initializeVehiclesForOperation();
    }

    return this.getKernelStatus();
  }

  async getPlantModel(): Promise<unknown> {
    return this.kernelApi.getPlantModel();
  }

  async getKernelVehicles(): Promise<unknown[]> {
    return this.kernelApi.getVehicleStates();
  }

  async getKernelDebug(): Promise<unknown> {
    return this.kernelApi.getDebugSnapshot();
  }

  async withdrawTransportOrder(name: string): Promise<void> {
    await this.kernelApi.withdrawTransportOrder(name);
  }

  async getCargoOptions(): Promise<{
    pickupLocations: { locationName: string; pointName: string }[];
    dropoffLocations: string[];
  }> {
    const [model, deliveredCargos] = await Promise.all([
      this.kernelApi.getLocationModel(),
      this.cargoRepo.find({
        where: { status: CargoStatus.DELIVERED },
        select: { destinationLocationName: true },
      }),
    ]);
    if (!model) return { pickupLocations: [], dropoffLocations: [] };

    const locationTypes: KernelLocationType[] = model.locationTypes ?? [];
    const locations: KernelLocation[] = model.locations ?? [];
    const occupiedDropoffLocations = new Set(
      deliveredCargos
        .map((cargo) => cargo.destinationLocationName)
        .filter((locationName): locationName is string =>
          Boolean(locationName),
        ),
    );

    const pickupTypeNames = new Set<string>(
      locationTypes
        .filter((locationType) =>
          locationType.allowedOperations.includes('PICK_UP'),
        )
        .map((locationType) => locationType.name),
    );
    const dropoffTypeNames = new Set<string>(
      locationTypes
        .filter((locationType) =>
          locationType.allowedOperations.includes('DROP_OFF'),
        )
        .map((locationType) => locationType.name),
    );

    const pickupLocations: { locationName: string; pointName: string }[] = [];
    const dropoffLocations: string[] = [];

    for (const loc of locations) {
      const typeName: string = loc.typeName ?? loc.type ?? '';
      if (pickupTypeNames.has(typeName)) {
        const links = loc.links;
        let pointName = '';
        if (Array.isArray(links) && links.length > 0) {
          pointName = links[0].pointName ?? links[0].point ?? '';
        } else if (links && typeof links === 'object') {
          pointName = Object.keys(links)[0] ?? '';
        }
        if (pointName) {
          pickupLocations.push({ locationName: loc.name, pointName });
        }
      }
      if (dropoffTypeNames.has(typeName)) {
        if (!occupiedDropoffLocations.has(loc.name)) {
          dropoffLocations.push(loc.name);
        }
      }
    }

    return {
      pickupLocations: pickupLocations.sort((a, b) =>
        a.locationName.localeCompare(b.locationName),
      ),
      dropoffLocations: dropoffLocations.sort(),
    };
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

    await savePlantModel(this.kernelApi, model);

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

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
import { applySingleVehicleBlocks } from '../opentcs/domain/apply-blocks';
import { savePlantModel } from '../opentcs/save-plant-model';
import { MapRecordEntity } from './entities/map-record.entity';
import { CargoEntity, CargoStatus } from '../cargo/entities/cargo.entity';

export type KernelMode = 'MODELLING' | 'OPERATING';

export interface KernelStatusDto {
  reachable: boolean;
  state: KernelMode | null;
}

export interface CurrentMapDto {
  name: string;
  pointCount: number;
  pathCount: number;
  vehicleCount: number;
  originalFilename: string | null;
  uploadedAt: Date | null;
  uploadedById: string | null;
}

interface KernelPlantModelSummary {
  name: string;
  pointCount: number;
  pathCount: number;
  vehicleCount: number;
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
    const plantModel = await this.kernelApi.getPlantModel();
    return this.toPlantModelSummary(plantModel) ? plantModel : null;
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

  async getCurrent(): Promise<CurrentMapDto | null> {
    const plantModel = this.toPlantModelSummary(
      await this.kernelApi.getPlantModel(),
    );
    if (!plantModel) {
      return null;
    }

    const latestRecord = await this.repo.findOne({
      where: { name: plantModel.name },
      order: { uploadedAt: 'DESC' },
    });

    return {
      ...plantModel,
      originalFilename: latestRecord?.originalFilename ?? null,
      uploadedAt: latestRecord?.uploadedAt ?? null,
      uploadedById: latestRecord?.uploadedById ?? null,
    };
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

    // Serialise single-file / dead-end lanes so the kernel scheduler prevents
    // multi-AGV deadlock on them (SINGLE_VEHICLE_ONLY blocks, graph-derived).
    const blockCount = applySingleVehicleBlocks(model).blocks.length;
    this.logger.log(`Generated ${blockCount} single-vehicle lane block(s)`);

    await savePlantModel(this.kernelApi, model);

    const record = this.repo.create({
      name: model.name,
      originalFilename,
      pointCount: model.points.length,
      pathCount: model.paths.length,
      vehicleCount: model.vehicles.length,
      uploadedById,
    });
    return this.repo.save(record);
  }

  private toPlantModelSummary(value: unknown): KernelPlantModelSummary | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const model = value as Record<string, unknown>;
    if (typeof model.name !== 'string') {
      return null;
    }

    const pointCount = Array.isArray(model.points) ? model.points.length : 0;
    const pathCount = Array.isArray(model.paths) ? model.paths.length : 0;
    const vehicleCount = Array.isArray(model.vehicles)
      ? model.vehicles.length
      : 0;
    const locationCount = Array.isArray(model.locations)
      ? model.locations.length
      : 0;

    const isUnnamedEmptyModel =
      model.name === 'unnamed' &&
      pointCount === 0 &&
      pathCount === 0 &&
      vehicleCount === 0 &&
      locationCount === 0;
    if (isUnnamedEmptyModel) {
      return null;
    }

    return {
      name: model.name,
      pointCount,
      pathCount,
      vehicleCount,
    };
  }
}

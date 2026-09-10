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
import { TransportOrderService } from '../opentcs/transport-order.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type {
  KernelLocation,
  KernelLocationType,
  KernelVehicleState,
} from '../opentcs/domain/kernel-model';
import { toKernelPlantModel } from '../opentcs/domain/kernel-mappers';
import { parseOpenTcsXml } from '../opentcs/map-loader/opentcs-xml.parser';
import { plantModelToXml } from '../opentcs/plant-model-to-xml';
import { savePlantModel } from '../opentcs/save-plant-model';
import {
  buildMapHealthReport,
  type MapHealthReport,
  type MapHealthZone,
} from './domain/map-health';
import { MapRecordEntity } from './entities/map-record.entity';
import { CargoEntity, CargoStatus } from '../cargo/entities/cargo.entity';
import {
  ZoneEntity,
  ZoneStatus,
  ZoneType,
} from '../zones/entities/zone.entity';

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

function vehicleNamesOf(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const vehicles = (raw as { vehicles?: unknown }).vehicles;
  if (!Array.isArray(vehicles)) return [];
  return vehicles.flatMap((vehicle: unknown) => {
    if (!vehicle || typeof vehicle !== 'object') return [];
    const name = (vehicle as { name?: unknown }).name;
    return typeof name === 'string' ? [name] : [];
  });
}

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    private readonly transportOrders: TransportOrderService,
    private readonly vehicleStateStore: VehicleStateStore,
    @InjectRepository(MapRecordEntity)
    private readonly repo: Repository<MapRecordEntity>,
    @InjectRepository(CargoEntity)
    private readonly cargoRepo: Repository<CargoEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
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
        `Không thể chuyển chế độ hệ thống điều khiển: ${msg}`,
      );
    }

    if (state === 'OPERATING') {
      await this.kernelApi.initializeVehiclesForOperation();
    }

    return this.getKernelStatus();
  }

  async getPlantModel(): Promise<unknown> {
    const plantModel = await this.kernelApi.getRawPlantModel();
    return this.toPlantModelSummary(plantModel) ? plantModel : null;
  }

  async getHealth(): Promise<MapHealthReport | null> {
    const raw = await this.kernelApi.getRawPlantModel();
    const summary = this.toPlantModelSummary(raw);
    if (!summary) return null;

    const model = toKernelPlantModel(raw);
    if (!model) return null;

    return buildMapHealthReport({
      mapName: summary.name,
      points: model.points,
      paths: model.paths,
      locations: model.locations,
      locationTypes: model.locationTypes,
      chargeOperation: this.kernelApi.chargeOperation,
      loadOperation: this.kernelApi.loadOperation,
      unloadOperation: this.kernelApi.unloadOperation,
      vehicleNames: vehicleNamesOf(raw),
      zones: await this.zonesDrawnOn(summary.name),
    });
  }

  private async zonesDrawnOn(mapName: string): Promise<MapHealthZone[]> {
    const zones = await this.zoneRepo.find({
      where: { plantModelName: mapName, status: ZoneStatus.ACTIVE },
    });
    return zones.map((zone) => ({
      name: zone.name,
      type: zone.type === ZoneType.PICKUP ? 'PICKUP' : 'DROPOFF',
      locationNames: [...zone.members]
        .sort((a, b) => a.positionIndex - b.positionIndex)
        .map((member) => member.locationName),
    }));
  }

  async getPlantModelXml(): Promise<string | null> {
    const plantModel = await this.kernelApi.getRawPlantModel();
    if (!this.toPlantModelSummary(plantModel)) return null;
    return plantModelToXml(plantModel);
  }

  async getKernelVehicles(): Promise<KernelVehicleState[]> {
    const vehicles = await this.kernelApi.getVehicleStates();
    return vehicles.map((vehicle) => ({
      ...vehicle,
      goal: this.vehicleStateStore.get(vehicle.name)?.goal ?? null,
    }));
  }

  async getKernelDebug(): Promise<unknown> {
    return this.kernelApi.getDebugSnapshot();
  }

  async withdrawTransportOrder(name: string): Promise<void> {
    await this.transportOrders.cancel(name);
  }

  async getCargoOptions(): Promise<{
    pickupLocations: { locationName: string; pointName: string }[];
    dropoffLocations: string[];
  }> {
    const [model, deliveredCargos] = await Promise.all([
      this.kernelApi.getPlantModelView(),
      this.cargoRepo.find({
        where: { status: CargoStatus.DELIVERED },
        select: { destinationLocationName: true },
      }),
    ]);
    if (!model) return { pickupLocations: [], dropoffLocations: [] };

    const locationTypes: KernelLocationType[] = model.locationTypes ?? [];
    const locations: KernelLocation[] = model.locations ?? [];
    const occupiedDropoffLocations = deliveredCargos.reduce((names, cargo) => {
      if (cargo.destinationLocationName)
        names.add(cargo.destinationLocationName);
      return names;
    }, new Set<string>());

    const pickupTypeNames = new Set<string>(
      locationTypes
        .filter((locationType) =>
          locationType.allowedOperations.includes(this.kernelApi.loadOperation),
        )
        .map((locationType) => locationType.name),
    );
    const dropoffTypeNames = new Set<string>(
      locationTypes
        .filter((locationType) =>
          locationType.allowedOperations.includes(
            this.kernelApi.unloadOperation,
          ),
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
      await this.kernelApi.getRawPlantModel(),
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

    // Auto-generation of single-vehicle lane blocks (SVB-*) DISABLED.
    // Previously WES derived SINGLE_VEHICLE_ONLY blocks from the path graph to
    // serialise single-file / dead-end lanes; only hand-authored blocks in the
    // uploaded XML are kept now.
    // const blockCount = applySingleVehicleBlocks(model).blocks.length;
    // this.logger.log(`Generated ${blockCount} single-vehicle lane block(s)`);

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

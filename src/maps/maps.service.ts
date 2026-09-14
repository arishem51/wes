import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
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
import {
  MapRecordEntity,
  type StoredMapPreview,
} from './entities/map-record.entity';
import { CargoEntity, CargoStatus } from '../cargo/entities/cargo.entity';
import {
  ZoneEntity,
  ZoneStatus,
  ZoneType,
} from '../zones/entities/zone.entity';
import { pointNameOf } from '../zones/domain/location-naming';
import { ZoneService } from '../zones/zone.service';

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

export interface MapLibraryItemDto {
  id: string;
  name: string;
  originalFilename: string;
  pointCount: number;
  pathCount: number;
  vehicleCount: number;
  locationCount: number;
  blockCount: number;
  uploadedAt: Date;
  uploadedById: string | null;
  lastLoadedAt: Date | null;
  active: boolean;
  preview: StoredMapPreview;
  areas: MapPreviewAreaDto[];
}

export interface MapPreviewAreaDto {
  id: string;
  name: string;
  kind: 'ZONE' | 'STORE';
  status: 'ACTIVE' | 'STALE';
  color: string;
  pointNames: string[];
}

export interface MapLibraryDetailDto extends MapLibraryItemDto {
  points: Array<{
    name: string;
    type: string;
    x: number;
    y: number;
    z: number;
  }>;
  paths: Array<{
    name: string;
    source: string;
    target: string;
    length: number;
    locked: boolean;
  }>;
  locations: Array<{
    name: string;
    type: string;
    pointNames: string[];
  }>;
  vehicles: string[];
  blocks: Array<{ name: string; type: string; memberNames: string[] }>;
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
    private readonly zoneService: ZoneService,
  ) {}

  async getKernelStatus(): Promise<KernelStatusDto> {
    const [reachable, state] = await Promise.all([
      this.kernelApi.isReachable(),
      this.kernelApi.getKernelState(),
    ]);
    return { reachable, state };
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

  async listLibrary(): Promise<MapLibraryItemDto[]> {
    const records = await this.repo.find({
      where: { xmlContent: Not(IsNull()) },
      order: { uploadedAt: 'DESC' },
    });
    if (records.length === 0) return [];

    const [currentName, zones] = await Promise.all([
      this.kernelApi.getPlantModelName(),
      this.zoneRepo.find({
        relations: { members: true },
      }),
    ]);
    const activeId = this.activeRecordId(records, currentName);
    return records.map((record) =>
      this.toLibraryItem(
        record,
        record.id === activeId,
        this.areasForMap(record.name, record.preview, zones),
      ),
    );
  }

  async getLibraryMap(id: string): Promise<MapLibraryDetailDto> {
    const record = await this.storedMap(id);
    const model = this.parseXml(record.xmlContent as string);
    const [currentName, zones] = await Promise.all([
      this.kernelApi.getPlantModelName(),
      this.zoneRepo.find({
        relations: { members: true },
      }),
    ]);

    return {
      ...this.toLibraryItem(
        record,
        record.name === currentName,
        this.areasForMap(record.name, this.previewOf(model), zones),
      ),
      points: model.points.map((point) => ({
        name: point.name,
        type: point.type,
        x: point.position.x,
        y: point.position.y,
        z: point.position.z,
      })),
      paths: model.paths.map((path) => ({
        name: path.name,
        source: path.srcPointName,
        target: path.destPointName,
        length: path.length,
        locked: path.locked,
      })),
      locations: model.locations.map((location) => ({
        name: location.name,
        type: location.typeName,
        pointNames: location.links.map((link) => link.pointName),
      })),
      vehicles: model.vehicles.map((vehicle) => vehicle.name),
      blocks: model.blocks.map((block) => ({
        name: block.name,
        type: block.type,
        memberNames: block.memberNames,
      })),
    };
  }

  async getLibraryXml(
    id: string,
  ): Promise<{ filename: string; content: string }> {
    const record = await this.storedMap(id);
    return {
      filename: record.originalFilename,
      content: record.xmlContent as string,
    };
  }

  async uploadToLibrary(
    xmlBuffer: Buffer,
    originalFilename: string,
    uploadedById: string,
  ): Promise<MapLibraryItemDto> {
    const xmlContent = xmlBuffer.toString('utf-8');

    let model: ReturnType<typeof parseOpenTcsXml>;
    try {
      model = parseOpenTcsXml(xmlContent);
    } catch (err) {
      throw new BadRequestException(
        `File XML không hợp lệ: ${(err as Error).message}`,
      );
    }

    if (!model.name?.trim()) {
      throw new BadRequestException('File XML không có tên plant model.');
    }

    // Auto-generation of single-vehicle lane blocks (SVB-*) DISABLED.
    // Previously WES derived SINGLE_VEHICLE_ONLY blocks from the path graph to
    // serialise single-file / dead-end lanes; only hand-authored blocks in the
    // uploaded XML are kept now.
    // const blockCount = applySingleVehicleBlocks(model).blocks.length;
    // this.logger.log(`Generated ${blockCount} single-vehicle lane block(s)`);

    const record = this.repo.create({
      name: model.name.trim(),
      originalFilename: originalFilename || `${model.name.trim()}.xml`,
      pointCount: model.points.length,
      pathCount: model.paths.length,
      vehicleCount: model.vehicles.length,
      locationCount: model.locations.length,
      blockCount: model.blocks.length,
      xmlContent,
      preview: this.previewOf(model),
      uploadedById,
      lastLoadedAt: null,
    });
    return this.toLibraryItem(await this.repo.save(record), false);
  }

  async loadLibraryMap(id: string): Promise<MapLibraryItemDto> {
    const record = await this.storedMap(id);
    const model = this.parseXml(record.xmlContent as string);

    await savePlantModel(this.kernelApi, model);
    await this.kernelApi.initializeVehiclesForOperation();

    const zoneSync = await this.zoneService.sync().catch((error) => {
      this.logger.warn(
        `Zone sync after loading "${record.name}" failed: ${(error as Error).message}`,
      );
      return null;
    });
    if (zoneSync) {
      this.logger.log(
        `Zone sync after loading "${record.name}": ${zoneSync.markedActive} active, ${zoneSync.markedStale} stale`,
      );
    }

    record.lastLoadedAt = new Date();
    const saved = await this.repo.save(record);
    this.logger.log(
      `Loaded stored map "${saved.name}" (${saved.id}) into the kernel`,
    );

    const zones = await this.zoneRepo.find({ relations: { members: true } });
    return this.toLibraryItem(
      saved,
      true,
      this.areasForMap(saved.name, saved.preview, zones),
    );
  }

  private async storedMap(id: string): Promise<MapRecordEntity> {
    const record = await this.repo.findOne({
      where: { id },
      select: {
        id: true,
        name: true,
        originalFilename: true,
        pointCount: true,
        pathCount: true,
        vehicleCount: true,
        locationCount: true,
        blockCount: true,
        xmlContent: true,
        preview: true,
        uploadedAt: true,
        uploadedById: true,
        lastLoadedAt: true,
      },
    });
    if (!record?.xmlContent) {
      throw new NotFoundException('Không tìm thấy bản đồ đã lưu trong WES.');
    }
    return record;
  }

  private parseXml(xmlContent: string): ReturnType<typeof parseOpenTcsXml> {
    try {
      return parseOpenTcsXml(xmlContent);
    } catch (err) {
      throw new BadRequestException(
        `File XML không hợp lệ: ${(err as Error).message}`,
      );
    }
  }

  private previewOf(
    model: ReturnType<typeof parseOpenTcsXml>,
  ): StoredMapPreview {
    return {
      points: model.points.map((point) => ({
        name: point.name,
        x: point.position.x,
        y: point.position.y,
        type: point.type,
      })),
      paths: model.paths.map((path) => ({
        name: path.name,
        source: path.srcPointName,
        target: path.destPointName,
        locked: path.locked,
      })),
    };
  }

  private toLibraryItem(
    record: MapRecordEntity,
    active: boolean,
    areas: MapPreviewAreaDto[] = [],
  ): MapLibraryItemDto {
    return {
      id: record.id,
      name: record.name,
      originalFilename: record.originalFilename,
      pointCount: record.pointCount,
      pathCount: record.pathCount,
      vehicleCount: record.vehicleCount,
      locationCount: record.locationCount,
      blockCount: record.blockCount,
      uploadedAt: record.uploadedAt,
      uploadedById: record.uploadedById,
      lastLoadedAt: record.lastLoadedAt,
      active,
      preview: record.preview ?? { points: [], paths: [] },
      areas,
    };
  }

  private areasForMap(
    mapName: string,
    preview: StoredMapPreview | null,
    zones: ZoneEntity[],
  ): MapPreviewAreaDto[] {
    const exact = zones.filter((zone) => zone.plantModelName === mapName);
    if (exact.length > 0) {
      return exact.map((zone) => this.toPreviewArea(zone));
    }

    // XML exports are often renamed while their topology stays unchanged.
    // If there is no exact map scope, display only complete WES areas whose
    // member points all exist in this map. Partial matches are deliberately
    // rejected so an area from a larger, different topology is not shown.
    const pointNames = new Set(
      (preview?.points ?? []).map((point) => point.name),
    );
    return zones
      .filter(
        (zone) =>
          zone.members.length > 0 &&
          zone.members.every((member) =>
            pointNames.has(pointNameOf(member.locationName)),
          ),
      )
      .map((zone) => this.toPreviewArea(zone));
  }

  private toPreviewArea(zone: ZoneEntity): MapPreviewAreaDto {
    return {
      id: zone.id,
      name: zone.name,
      kind: zone.type === ZoneType.PICKUP ? 'ZONE' : 'STORE',
      status: zone.status === ZoneStatus.ACTIVE ? 'ACTIVE' : 'STALE',
      color:
        zone.color ?? (zone.type === ZoneType.PICKUP ? '#2563EB' : '#16A34A'),
      pointNames: [...zone.members]
        .sort((a, b) => a.positionIndex - b.positionIndex)
        .map((member) => pointNameOf(member.locationName)),
    };
  }

  private activeRecordId(
    records: MapRecordEntity[],
    currentName: string | null,
  ): string | null {
    if (!currentName) return null;
    const matching = records.filter((record) => record.name === currentName);
    matching.sort(
      (a, b) =>
        (b.lastLoadedAt ?? b.uploadedAt).getTime() -
        (a.lastLoadedAt ?? a.uploadedAt).getTime(),
    );
    return matching[0]?.id ?? null;
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

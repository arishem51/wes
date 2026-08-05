import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PlantModelDto } from './map-loader/opentcs-xml.parser';
import type {
  CreateTransportOrderOptions,
  KernelChargeLocation,
  KernelParkingPoint,
  KernelPlantModel,
  KernelRoute,
  KernelTransportOrder,
  KernelTransportOrderSummary,
  KernelVehicleState,
  TransportOrderDestination,
  TransportOrderResponse,
} from './domain/kernel-model';
import {
  locationPointNames,
  toKernelPlantModel,
  toKernelTransportOrders,
  toKernelVehicleStates,
  toTransportOrderDebugList,
  unusablePlantModelEntries,
} from './domain/kernel-mappers';
import { vehicleOperationsFor } from './domain/vehicle-operations';

@Injectable()
export class KernelApiService {
  private readonly logger = new Logger(KernelApiService.name);
  private readonly baseUrl: string;
  readonly loadOperation: string;
  readonly unloadOperation: string;
  readonly chargeOperation: string;

  private cachedPlantModel: unknown = null;
  private cachedPlantModelView: KernelPlantModel | null = null;

  constructor() {
    this.baseUrl = process.env.OPENTCS_KERNEL_URL ?? 'http://localhost:55200';
    const operations = vehicleOperationsFor(
      process.env.VEHICLE_TYPE ?? 'loopback',
    );
    this.loadOperation = operations.load;
    this.unloadOperation = operations.unload;
    this.chargeOperation = operations.charge;
  }

  async isReachable(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/v1/kernel/version`, { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  async putPlantModel(model: PlantModelDto): Promise<void> {
    await axios.put(`${this.baseUrl}/v1/plantModel`, model, {
      headers: { 'Content-Type': 'application/json' },
    });
    this.invalidatePlantModelCache();
    this.logger.log(`Plant model "${model.name}" loaded into kernel`);
  }

  async putRawPlantModel(model: unknown): Promise<void> {
    await axios.put(`${this.baseUrl}/v1/plantModel`, model, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15_000,
    });
    this.invalidatePlantModelCache();
    this.logger.log('Plant model patched');
  }

  async getPlantModelName(): Promise<string | null> {
    try {
      const res = await axios.get<{ name: string }>(
        `${this.baseUrl}/v1/plantModel`,
      );
      return res.data.name;
    } catch {
      return null;
    }
  }

  invalidatePlantModelCache(): void {
    this.cachedPlantModel = null;
    this.cachedPlantModelView = null;
  }

  async getRawPlantModel(): Promise<unknown> {
    if (this.cachedPlantModel) return this.cachedPlantModel;
    try {
      const res = await axios.get(`${this.baseUrl}/v1/plantModel`, {
        timeout: 10_000,
      });
      this.cachedPlantModel = res.data;
      return this.cachedPlantModel;
    } catch {
      return null;
    }
  }

  async getPlantModelView(): Promise<KernelPlantModel | null> {
    if (this.cachedPlantModelView) return this.cachedPlantModelView;

    const raw = await this.getRawPlantModel();
    const view = toKernelPlantModel(raw);
    if (!view) return null;

    const unusable = unusablePlantModelEntries(raw, view);
    if (unusable.length > 0) {
      this.logger.warn(
        `Plant model: ignored ${unusable.join(', ')} the kernel reported in an unusable shape`,
      );
    }

    this.cachedPlantModelView = view;
    return view;
  }

  async getPointNamesByLocation(): Promise<Map<string, string[]>> {
    const model = await this.getPlantModelView();
    if (!model) return new Map();
    return new Map(
      model.locations.map((location) => [
        location.name,
        locationPointNames(location.links),
      ]),
    );
  }

  async getParkingPoints(): Promise<KernelParkingPoint[]> {
    const model = await this.getPlantModelView();
    if (!model) return [];

    return model.points
      .filter((point) => point.type === 'PARK_POSITION')
      .map((point) => ({ name: point.name, priority: point.parkingPriority }));
  }

  async getChargeLocations(): Promise<KernelChargeLocation[]> {
    const model = await this.getPlantModelView();
    if (!model) return [];

    const chargeTypeNames = new Set<string>(
      model.locationTypes
        .filter((type) => type.allowedOperations.includes(this.chargeOperation))
        .map((type) => type.name),
    );

    const out: KernelChargeLocation[] = [];
    for (const loc of model.locations) {
      const typeName = loc.typeName ?? loc.type ?? '';
      if (!chargeTypeNames.has(typeName)) continue;
      const points = locationPointNames(loc.links);
      if (points.length > 0) out.push({ name: loc.name, points });
    }
    return out;
  }

  async findPickupLocationForPoint(pointName: string): Promise<string | null> {
    const model = await this.getPlantModelView();
    if (!model) return null;

    const pickupTypeNames = new Set<string>(
      model.locationTypes
        .filter((locationType) =>
          locationType.allowedOperations.includes(this.loadOperation),
        )
        .map((locationType) => locationType.name),
    );

    const pickup = model.locations.find(
      (loc) =>
        pickupTypeNames.has(loc.typeName ?? loc.type ?? '') &&
        locationPointNames(loc.links).includes(pointName),
    );
    return pickup?.name ?? null;
  }

  async findPointForLocation(locationName: string): Promise<string | null> {
    const model = await this.getPlantModelView();
    if (!model) return null;

    const location = model.locations.find((loc) => loc.name === locationName);
    return location ? (locationPointNames(location.links)[0] ?? null) : null;
  }

  async getVehicles(): Promise<Array<KernelVehicleState>> {
    const res = await axios.get<Array<KernelVehicleState>>(
      `${this.baseUrl}/v1/vehicles`,
      { timeout: 3_000 },
    );
    return res.data;
  }

  async getVehicleStates(): Promise<KernelVehicleState[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/v1/vehicles`, {
        timeout: 5_000,
      });
      return toKernelVehicleStates(res.data);
    } catch {
      return [];
    }
  }

  async getDebugSnapshot(): Promise<unknown> {
    const [vehicles, orders] = await Promise.allSettled([
      axios.get(`${this.baseUrl}/v1/vehicles`, { timeout: 5_000 }),
      axios.get(`${this.baseUrl}/v1/transportOrders`, { timeout: 5_000 }),
    ]);

    return {
      vehicles:
        vehicles.status === 'fulfilled'
          ? toKernelVehicleStates(vehicles.value.data).map((vehicle) => ({
              name: vehicle.name,
              state: vehicle.state,
              procState: vehicle.procState,
              integrationLevel: vehicle.integrationLevel,
              currentPosition: vehicle.currentPosition,
              paused: vehicle.paused,
            }))
          : `ERROR: ${vehicles.reason}`,
      transportOrders:
        orders.status === 'fulfilled'
          ? toTransportOrderDebugList(orders.value.data)
          : `ERROR: ${orders.reason}`,
    };
  }

  async getEvents(minSequenceNo: number, timeout: number): Promise<unknown> {
    const res = await axios.get(
      `${this.baseUrl}/v1/events?minSequenceNo=${minSequenceNo}&timeout=${timeout}`,
      { timeout: timeout + 3_000 },
    );
    return res.data;
  }

  async createTransportOrder(
    name: string,
    destinations: TransportOrderDestination[],
    intendedVehicle: string,
    properties?: Record<string, string>,
    options: CreateTransportOrderOptions = {},
  ): Promise<KernelTransportOrderSummary> {
    const body: Record<string, unknown> = {
      destinations,
      intendedVehicle,
      dispensable: options.dispensable === true,
    };
    if (properties) {
      body.properties = Object.entries(properties).map(([key, value]) => ({
        key,
        value,
      }));
    }
    const res = await axios.post<TransportOrderResponse>(
      `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}`,
      body,
      { timeout: 10_000 },
    );
    this.logger.log(`Created TO "${name}" → ${intendedVehicle}`);
    await this.triggerDispatcher();

    const created = res.data;
    return {
      name: created.name,
      state: created.state,
      destinations: created.destinations.map(
        (destination) => destination.locationName,
      ),
    };
  }

  async computeRoutes(
    vehicleName: string,
    destinationPoints: string[],
    sourcePoint?: string,
  ): Promise<KernelRoute[]> {
    const body: Record<string, unknown> = { destinationPoints };
    if (sourcePoint) body.sourcePoint = sourcePoint;
    const res = await axios.post<{ routes?: KernelRoute[] }>(
      `${this.baseUrl}/v1/vehicles/${encodeURIComponent(vehicleName)}/routeComputationQuery`,
      body,
      { timeout: 10_000 },
    );
    return res.data?.routes ?? [];
  }

  async triggerDispatcher(): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/v1/dispatcher/trigger`, null, {
        timeout: 5_000,
      });
    } catch {
      // non-fatal
    }
  }

  async withdrawTransportOrder(name: string, immediate = false): Promise<void> {
    await axios.post(
      `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}/withdrawal?immediate=${immediate}`,
      null,
      { timeout: 10_000 },
    );
  }

  async getTransportOrders(
    intendedVehicle?: string,
  ): Promise<KernelTransportOrder[]> {
    const res = await axios.get(`${this.baseUrl}/v1/transportOrders`, {
      params: intendedVehicle ? { intendedVehicle } : undefined,
      timeout: 10_000,
    });
    if (!Array.isArray(res.data)) {
      throw new Error(
        `Unexpected /v1/transportOrders payload (${intendedVehicle ?? 'fleet-wide'})`,
      );
    }
    return toKernelTransportOrders(res.data);
  }

  async getTransportOrderState(name: string): Promise<string | null> {
    try {
      const res = await axios.get(
        `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}`,
        { timeout: 5_000 },
      );
      return (res.data as { state?: string })?.state ?? null;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return 'NOT_FOUND';
      }
      return null;
    }
  }

  async getTransportOrderStateStrict(name: string): Promise<string | null> {
    try {
      const res = await axios.get(
        `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}`,
        { timeout: 5_000 },
      );
      const state = (res.data as { state?: unknown })?.state;
      if (typeof state !== 'string') {
        throw new Error(`Transport order "${name}" carried no state`);
      }
      return state;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  async getKernelState(): Promise<'MODELLING' | 'OPERATING' | null> {
    try {
      const res = await axios.get<{ state: string }>(
        `${this.baseUrl}/v1/kernel`,
        { timeout: 3_000 },
      );
      const s = res.data?.state;
      if (s === 'MODELLING' || s === 'OPERATING') return s;
      return null;
    } catch {
      return null;
    }
  }

  async setVehicleProperty(
    vehicleName: string,
    key: string,
    value: string,
  ): Promise<void> {
    await axios.post(
      `${this.baseUrl}/v1/vehicles/${encodeURIComponent(vehicleName)}/commAdapter/message`,
      {
        type: 'tcs:virtualVehicle:setProperty',
        parameters: [
          { key: 'key', value: key },
          { key: 'value', value: value },
        ],
      },
      { timeout: 5_000 },
    );
  }

  async sendInstantAction(
    vehicleName: string,
    actionType: string,
  ): Promise<void> {
    await axios.post(
      `${this.baseUrl}/v1/vehicles/${encodeURIComponent(vehicleName)}/commAdapter/message`,
      {
        type: 'vda5050:sendInstantAction',
        parameters: [
          { key: 'actionType', value: actionType },
          { key: 'actionId', value: randomUUID() },
          { key: 'blockingType', value: 'NONE' },
        ],
      },
      { timeout: 5_000 },
    );
  }

  async setVehicleAdapterEnabled(
    vehicleName: string,
    enabled: boolean,
  ): Promise<void> {
    await axios.put(
      `${this.baseUrl}/v1/vehicles/${encodeURIComponent(vehicleName)}/commAdapter/enabled?newValue=${enabled}`,
      null,
      { timeout: 5_000 },
    );
  }

  async setVehicleIntegrationLevel(
    vehicleName: string,
    level:
      | 'TO_BE_IGNORED'
      | 'TO_BE_NOTICED'
      | 'TO_BE_RESPECTED'
      | 'TO_BE_UTILIZED',
  ): Promise<void> {
    await axios.put(
      `${this.baseUrl}/v1/vehicles/${encodeURIComponent(vehicleName)}/integrationLevel?newValue=${level}`,
      null,
      { timeout: 5_000 },
    );
  }

  async initializeVehiclesForOperation(): Promise<void> {
    const vehicles = await this.getVehicles().catch(
      () => [] as KernelVehicleState[],
    );
    for (const v of vehicles) {
      try {
        await this.setVehicleAdapterEnabled(v.name, true);
        await this.setVehicleIntegrationLevel(v.name, 'TO_BE_UTILIZED');
        this.logger.log(
          `Vehicle "${v.name}" → adapter enabled, TO_BE_UTILIZED`,
        );
      } catch (err) {
        this.logger.warn(
          `Could not initialize vehicle "${v.name}": ${(err as Error).message}`,
        );
      }
    }
  }

  async setKernelState(state: 'MODELLING' | 'OPERATING'): Promise<void> {
    await axios.put(`${this.baseUrl}/v1/kernel/state?newValue=${state}`, null, {
      timeout: 10_000,
    });
  }
}

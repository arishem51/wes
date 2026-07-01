import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PlantModelDto } from './map-loader/opentcs-xml.parser';

export interface KernelVehicleState {
  name: string;
  state:
    | 'UNKNOWN'
    | 'UNAVAILABLE'
    | 'ERROR'
    | 'IDLE'
    | 'EXECUTING'
    | 'CHARGING';
  procState: 'UNAVAILABLE' | 'IDLE' | 'AWAITING_ORDER' | 'PROCESSING_ORDER';
  integrationLevel:
    | 'TO_BE_IGNORED'
    | 'TO_BE_NOTICED'
    | 'TO_BE_RESPECTED'
    | 'TO_BE_UTILIZED';
  energyLevel: number;
  paused: boolean;
  currentPosition: string | null;
}

export interface KernelLocationType {
  name: string;
  allowedOperations: string[];
}

export interface KernelLocationLink {
  pointName?: string;
  point?: string;
}

export interface KernelLocation {
  name: string;
  typeName?: string;
  type?: string;
  links?: KernelLocationLink[] | Record<string, unknown>;
}

export interface KernelPlantModel {
  locationTypes: KernelLocationType[];
  locations: KernelLocation[];
}

interface KernelTransportOrderDebug {
  name?: string;
  state?: string;
  intendedVehicle?: string;
  processingVehicle?: string;
  destinations?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toKernelLocationType(value: unknown): KernelLocationType | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  return {
    name: value.name,
    allowedOperations: toStringArray(value.allowedOperations),
  };
}

function toKernelLocationLink(value: unknown): KernelLocationLink | null {
  if (!isRecord(value)) {
    return null;
  }

  const pointName =
    typeof value.pointName === 'string' ? value.pointName : undefined;
  const point = typeof value.point === 'string' ? value.point : undefined;
  return pointName || point ? { pointName, point } : null;
}

function toKernelLocation(value: unknown): KernelLocation | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  const links = Array.isArray(value.links)
    ? value.links
        .map((link) => toKernelLocationLink(link))
        .filter((link): link is KernelLocationLink => link !== null)
    : isRecord(value.links)
      ? value.links
      : undefined;

  return {
    name: value.name,
    typeName: typeof value.typeName === 'string' ? value.typeName : undefined,
    type: typeof value.type === 'string' ? value.type : undefined,
    links,
  };
}

function toKernelPlantModel(value: unknown): KernelPlantModel | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    locationTypes: Array.isArray(value.locationTypes)
      ? value.locationTypes
          .map((item) => toKernelLocationType(item))
          .filter((item): item is KernelLocationType => item !== null)
      : [],
    locations: Array.isArray(value.locations)
      ? value.locations
          .map((item) => toKernelLocation(item))
          .filter((item): item is KernelLocation => item !== null)
      : [],
  };
}

function toKernelVehicleState(value: unknown): KernelVehicleState | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  return {
    name: value.name,
    state:
      value.state === 'UNKNOWN' ||
      value.state === 'UNAVAILABLE' ||
      value.state === 'ERROR' ||
      value.state === 'IDLE' ||
      value.state === 'EXECUTING' ||
      value.state === 'CHARGING'
        ? value.state
        : 'UNKNOWN',
    procState:
      value.procState === 'UNAVAILABLE' ||
      value.procState === 'IDLE' ||
      value.procState === 'AWAITING_ORDER' ||
      value.procState === 'PROCESSING_ORDER'
        ? value.procState
        : 'UNAVAILABLE',
    integrationLevel:
      value.integrationLevel === 'TO_BE_IGNORED' ||
      value.integrationLevel === 'TO_BE_NOTICED' ||
      value.integrationLevel === 'TO_BE_RESPECTED' ||
      value.integrationLevel === 'TO_BE_UTILIZED'
        ? value.integrationLevel
        : 'TO_BE_IGNORED',
    energyLevel: typeof value.energyLevel === 'number' ? value.energyLevel : 0,
    paused: typeof value.paused === 'boolean' ? value.paused : false,
    currentPosition:
      typeof value.currentPosition === 'string' ? value.currentPosition : null,
  };
}

function toTransportOrderDebug(
  value: unknown,
): KernelTransportOrderDebug | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    state: typeof value.state === 'string' ? value.state : undefined,
    intendedVehicle:
      typeof value.intendedVehicle === 'string'
        ? value.intendedVehicle
        : undefined,
    processingVehicle:
      typeof value.processingVehicle === 'string'
        ? value.processingVehicle
        : undefined,
    destinations: value.destinations,
  };
}

@Injectable()
export class KernelApiService {
  private readonly logger = new Logger(KernelApiService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.OPENTCS_KERNEL_URL ?? 'http://localhost:55200';
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
    this.logger.log(`Plant model "${model.name}" loaded into kernel`);
  }

  async putRawPlantModel(model: unknown): Promise<void> {
    await axios.put(`${this.baseUrl}/v1/plantModel`, model, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15_000,
    });
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

  async getPlantModel(): Promise<unknown> {
    try {
      const res = await axios.get(`${this.baseUrl}/v1/plantModel`, {
        timeout: 10_000,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  async getLocationModel(): Promise<KernelPlantModel | null> {
    return toKernelPlantModel(await this.getPlantModel());
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
      return Array.isArray(res.data)
        ? res.data
            .map((item) => toKernelVehicleState(item))
            .filter((item): item is KernelVehicleState => item !== null)
        : [];
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
          ? Array.isArray(vehicles.value.data)
            ? vehicles.value.data
                .map((item) => toKernelVehicleState(item))
                .filter((item): item is KernelVehicleState => item !== null)
                .map((vehicle) => ({
                  name: vehicle.name,
                  state: vehicle.state,
                  procState: vehicle.procState,
                  integrationLevel: vehicle.integrationLevel,
                  currentPosition: vehicle.currentPosition,
                  paused: vehicle.paused,
                }))
            : []
          : `ERROR: ${vehicles.reason}`,
      transportOrders:
        orders.status === 'fulfilled'
          ? Array.isArray(orders.value.data)
            ? orders.value.data
                .map((item) => toTransportOrderDebug(item))
                .filter(
                  (item): item is KernelTransportOrderDebug => item !== null,
                )
                .map((order) => ({
                  name: order.name,
                  state: order.state,
                  intendedVehicle: order.intendedVehicle,
                  processingVehicle: order.processingVehicle,
                  destinations: order.destinations,
                }))
            : []
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
    destinations: Array<{ locationName: string; operation: string }>,
    intendedVehicle?: string,
  ): Promise<void> {
    // Omit intendedVehicle → the kernel (DefaultDispatcher) assigns a free
    // vehicle itself and FMSRouter routes it with MAPF.
    const body: Record<string, unknown> = { destinations };
    if (intendedVehicle) body.intendedVehicle = intendedVehicle;
    await axios.post(
      `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}`,
      body,
      { timeout: 10_000 },
    );
    this.logger.log(
      `Created TO "${name}"${intendedVehicle ? ` → ${intendedVehicle}` : ' (kernel-assigned)'}`,
    );
    await this.triggerDispatcher();
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

  async withdrawTransportOrder(name: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}/withdrawal?immediate=true`,
        null,
        { timeout: 5_000 },
      );
    } catch (err) {
      // The order no longer exists (e.g. the kernel was restarted) — there is
      // nothing to withdraw, so treat it as already gone instead of throwing.
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        this.logger.debug(`Withdraw skipped — order "${name}" no longer exists`);
        return;
      }
      throw err;
    }
  }

  async getTransportOrderState(name: string): Promise<string | null> {
    try {
      const res = await axios.get(
        `${this.baseUrl}/v1/transportOrders/${encodeURIComponent(name)}`,
        { timeout: 5_000 },
      );
      return (res.data as { state?: string })?.state ?? null;
    } catch {
      return null;
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

  async findPickupLocationForPoint(pointName: string): Promise<string | null> {
    const model = await this.getLocationModel();
    if (!model) return null;

    const pickupTypeNames = new Set<string>(
      model.locationTypes
        .filter((locationType) =>
          locationType.allowedOperations.includes('PICK_UP'),
        )
        .map((locationType) => locationType.name),
    );

    for (const loc of model.locations) {
      const typeName: string = loc.typeName ?? loc.type ?? '';
      if (!pickupTypeNames.has(typeName)) continue;

      let linked = false;
      if (Array.isArray(loc.links)) {
        linked = loc.links.some(
          (link) => link.pointName === pointName || link.point === pointName,
        );
      } else if (loc.links) {
        linked = pointName in loc.links;
      }

      if (linked) return loc.name;
    }

    return null;
  }

  async findPointForLocation(locationName: string): Promise<string | null> {
    const model = await this.getLocationModel();
    if (!model) return null;

    const location = model.locations.find((loc) => loc.name === locationName);
    if (!location?.links) return null;

    if (Array.isArray(location.links)) {
      const firstLink = location.links[0];
      return firstLink?.pointName ?? firstLink?.point ?? null;
    }

    return Object.keys(location.links)[0] ?? null;
  }

  /**
   * Whether a vehicle can reach the point a location is attached to. Catches
   * isolated points (no paths) so cargo to an undeliverable destination is
   * rejected up front instead of becoming an UNROUTABLE order.
   */
  async isLocationReachable(locationName: string): Promise<boolean> {
    const pointName = await this.findPointForLocation(locationName);
    if (!pointName) return false;

    // NOTE: the web-API plant model names these fields srcPointName/destPointName
    // (not sourcePoint/destinationPoint).
    const model = (await this.getPlantModel()) as {
      paths?: Array<{
        srcPointName?: string;
        destPointName?: string;
        maxVelocity?: number;
        maxReverseVelocity?: number;
      }>;
    } | null;
    const paths = Array.isArray(model?.paths) ? model.paths : [];

    const traversable = (v: number | undefined): boolean =>
      v === undefined || v !== 0;
    // Arrive via a forward edge into the point, or the reverse of an edge out of it.
    return paths.some(
      (p) =>
        (p.destPointName === pointName && traversable(p.maxVelocity)) ||
        (p.srcPointName === pointName && traversable(p.maxReverseVelocity)),
    );
  }

  async setVehiclePosition(
    vehicleName: string,
    pointName: string,
  ): Promise<void> {
    await axios.post(
      `${this.baseUrl}/v1/vehicles/${encodeURIComponent(vehicleName)}/commAdapter/message`,
      {
        type: 'tcs:virtualVehicle:setPosition',
        parameters: [{ key: 'position', value: pointName }],
      },
      { timeout: 5_000 },
    );
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

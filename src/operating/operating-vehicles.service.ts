import { Injectable } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { KernelApiService } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import type { KernelVehicleState } from '../opentcs/domain/kernel-model';
import { OperatingOrdersService } from './operating-orders.service';
import type { VehicleRealtimeDto } from './dto/operating.dto';

/** WES names drop-off orders `DROPOFF-<vehicle>-<destination>-<uuid>` (transport-order-name.ts). */
const LOADED_ORDER_PREFIX = 'DROPOFF-';

function toDto(vehicle: KernelVehicleState): VehicleRealtimeDto {
  const transportOrder = vehicle.transportOrder ?? null;
  return {
    name: vehicle.name,
    x: vehicle.precisePosition?.x ?? null,
    y: vehicle.precisePosition?.y ?? null,
    orientationAngle:
      typeof vehicle.orientationAngle === 'number' ? vehicle.orientationAngle : null,
    currentPosition: vehicle.currentPosition ?? null,
    state: vehicle.state,
    procState: vehicle.procState,
    integrationLevel: vehicle.integrationLevel,
    energyLevel: vehicle.energyLevel,
    transportOrder,
    paused: vehicle.paused,
    loaded: (transportOrder ?? '').startsWith(LOADED_ORDER_PREFIX),
    routePoints: [],
  };
}

/**
 * `GET /vehicles` snapshot for first paint; `GET /vehicles/stream` (SSE) pushes one updated
 * vehicle per kernel event afterwards. Both are enriched with the vehicle's remaining route
 * points. Source is the shared `VehicleStateStore` (fed by the always-on kernel SSE listener) —
 * this module never opens a second SSE connection to the kernel.
 */
@Injectable()
export class OperatingVehiclesService {
  constructor(
    private readonly store: VehicleStateStore,
    private readonly kernelApi: KernelApiService,
    private readonly orders: OperatingOrdersService,
  ) {}

  async snapshot(): Promise<VehicleRealtimeDto[]> {
    const stored = this.store.getAll();
    const source = stored.length > 0 ? stored : await this.kernelApi.getVehicleStates();
    return Promise.all(source.map((vehicle) => this.withRoute(toDto(vehicle))));
  }

  get updates$(): Observable<VehicleRealtimeDto> {
    return this.store.vehicleUpdates.pipe(
      mergeMap((vehicle) => from(this.withRoute(toDto(vehicle)))),
    );
  }

  private async withRoute(dto: VehicleRealtimeDto): Promise<VehicleRealtimeDto> {
    if (!dto.transportOrder) return dto;
    const routePoints = await this.orders
      .routeRemainingPoints(dto.transportOrder)
      .catch(() => [] as string[]);
    return { ...dto, routePoints };
  }
}

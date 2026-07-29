import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ORDER_PROP } from './domain/events';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { TransportTaskEntity } from './entities/transport-task.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { ParkClaimStore } from './park-claim.store';
import { RoutingService } from './routing.service';
import { activeCargoVehicleNames } from './task-queries';
import { shortestDistancesFrom } from './domain/routing';
import { ParkingPoint, pickParkingPoint } from './domain/parking.policy';
import {
  ChargeLocation,
  ChargeVehicleCandidate,
  needsCharging,
  isReleaseCandidate,
  shouldRelease,
  pickChargeLocation,
} from './domain/charge.policy';
import {
  CHARGE_LEG,
  PARK_LEG,
  STOP_CHARGING_ACTION,
  DEFAULT_FULL_CHARGE_PCT,
  TERMINAL_ORDER_STATES,
} from './charge-engine.constants';
import { ORDER_TYPE, buildOrderName } from './domain/transport-order-name';

function isIdleAvailable(state: KernelVehicleState | undefined): boolean {
  if (!state) return false;
  return (
    (state.procState === 'IDLE' || state.procState === 'AWAITING_ORDER') &&
    state.integrationLevel === 'TO_BE_UTILIZED'
  );
}

@Injectable()
export class ChargeEngineService {
  private readonly logger = new Logger(ChargeEngineService.name);
  private readonly chargeTargets = new Map<
    string,
    { location: string; order: string }
  >();
  private readonly fullChargePct: number;

  constructor(
    @InjectRepository(TransportTaskEntity)
    private readonly taskRepo: Repository<TransportTaskEntity>,
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly routing: RoutingService,
    private readonly parkClaims: ParkClaimStore,
  ) {
    const parsed = Number(process.env.CHARGE_FULL_PCT);
    this.fullChargePct =
      Number.isFinite(parsed) && parsed > 0 && parsed <= 100
        ? parsed
        : DEFAULT_FULL_CHARGE_PCT;
  }

  async run(): Promise<void> {
    const locations = await this.kernelApi.getChargeLocations();
    if (locations.length === 0) return;

    const chargePoints = new Set<string>();
    for (const loc of locations) {
      for (const point of loc.points) chargePoints.add(point);
    }

    await this.reconcileChargeTargets(chargePoints);

    const agvs = await this.agvRepo.find();
    const busy = await activeCargoVehicleNames(this.taskRepo);
    const parkingPoints = await this.kernelApi.getParkingPoints();
    const parkPointNames = new Set(parkingPoints.map((p) => p.name));
    const nonChargeParks = parkingPoints.filter(
      (p) => !chargePoints.has(p.name),
    );

    await this.releaseCharged(agvs, busy);
    await this.dispatchToCharge(
      agvs,
      locations,
      chargePoints,
      nonChargeParks,
      parkPointNames,
      busy,
    );
  }

  private toCandidate(
    agv: AgvEntity,
    fms: KernelVehicleState | undefined,
    busy: ReadonlySet<string>,
  ): ChargeVehicleCandidate {
    return {
      name: agv.name,
      dispatchEnabled: agv.isDispatchEnabled,
      ignored: agv.isIgnored,
      idleAvailable: isIdleAvailable(fms),
      charging: fms?.state === 'CHARGING',
      onOrder: fms?.transportOrder != null,
      hasActiveTask: busy.has(agv.name),
      currentPosition: fms?.currentPosition ?? null,
      energyLevel: fms?.energyLevel ?? 0,
      criticalThreshold: agv.criticalBatteryThreshold,
      sufficientThreshold: agv.sufficientBatteryThreshold,
    };
  }

  private async releaseCharged(
    agvs: AgvEntity[],
    busy: ReadonlySet<string>,
  ): Promise<void> {
    for (const agv of agvs) {
      const cand = this.toCandidate(agv, this.vehicleStore.get(agv.name), busy);
      if (!isReleaseCandidate(cand)) continue;
      if (!shouldRelease(cand, this.fullChargePct)) continue;
      await this.stopCharging(agv.name);
    }
  }

  private async stopCharging(vehicleName: string): Promise<void> {
    try {
      await this.kernelApi.sendInstantAction(vehicleName, STOP_CHARGING_ACTION);
      this.logger.log(`Released ${vehicleName} from charge`);
    } catch (err) {
      this.logger.warn(
        `Failed to release ${vehicleName}: ${(err as Error).message}`,
      );
    }
  }

  private occupiedPoints(
    agvs: AgvEntity[],
    points: readonly { name: string }[],
  ): Set<string> {
    const names = new Set(points.map((p) => p.name));
    const occupied = new Set<string>();
    for (const agv of agvs) {
      const pos = this.vehicleStore.get(agv.name)?.currentPosition;
      if (pos && names.has(pos)) occupied.add(pos);
    }
    return occupied;
  }

  private async dispatchToCharge(
    agvs: AgvEntity[],
    locations: readonly ChargeLocation[],
    chargePoints: ReadonlySet<string>,
    nonChargeParks: readonly ParkingPoint[],
    parkPointNames: ReadonlySet<string>,
    busy: ReadonlySet<string>,
  ): Promise<void> {
    const readyToCharge: Array<{ name: string; position: string }> = [];
    for (const agv of agvs) {
      const cand = this.toCandidate(agv, this.vehicleStore.get(agv.name), busy);
      if (!needsCharging(cand, chargePoints)) continue;
      if (this.hasInFlightCharge(agv.name, chargePoints)) continue;
      if (cand.currentPosition == null) continue;
      readyToCharge.push({ name: agv.name, position: cand.currentPosition });
    }
    if (readyToCharge.length === 0) return;

    const freeSlots = this.freeSlotsByLocation(locations, chargePoints);
    const graph = await this.routing.getRoadGraph();
    const parkExcluded = this.occupiedPoints(agvs, nonChargeParks);
    for (const point of this.parkClaims.claimedPoints()) {
      parkExcluded.add(point);
    }

    const canPark = this.parkClaims.isReady();
    const parkClaimedVehicles = this.parkClaims.claimedVehicles();
    if (!canPark) {
      this.logger.warn(
        'Park claims not rehydrated from the kernel — charging still dispatches, the no-slot park fallback is skipped',
      );
    }

    for (const { name, position } of readyToCharge) {
      const distances = graph
        ? shortestDistancesFrom(graph, position)
        : new Map<string, number>();

      const location = pickChargeLocation(locations, distances, freeSlots);
      if (location) {
        freeSlots.set(location.name, (freeSlots.get(location.name) ?? 0) - 1);
        await this.createChargeOrder(name, location.name);
        continue;
      }

      if (!canPark) continue;
      if (parkPointNames.has(position)) continue;
      if (parkClaimedVehicles.has(name)) continue;
      const point = pickParkingPoint(nonChargeParks, distances, parkExcluded);
      if (!point) {
        this.logger.debug(
          `No charge slot and no free park for ${name} — waiting`,
        );
        continue;
      }
      parkExcluded.add(point.name);
      await this.parkForNoSlot(name, point.name);
    }
  }

  private async parkForNoSlot(
    vehicleName: string,
    pointName: string,
  ): Promise<void> {
    const orderName = buildOrderName(
      ORDER_TYPE.PARK,
      vehicleName,
      pointName,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: pointName, operation: 'MOVE' }],
        vehicleName,
        { [ORDER_PROP.LEG]: PARK_LEG },
        { dispensable: true },
      );
      this.parkClaims.claim(vehicleName, pointName, orderName);
      this.logger.log(
        `Charge fallback park: ${vehicleName} → ${pointName} (${orderName})`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to park ${vehicleName}: ${(err as Error).message}`,
      );
    }
  }

  private freeSlotsByLocation(
    locations: readonly ChargeLocation[],
    chargePoints: ReadonlySet<string>,
  ): Map<string, number> {
    const occupied = new Set<string>();
    for (const vehicle of this.vehicleStore.getAll()) {
      if (
        vehicle.currentPosition &&
        chargePoints.has(vehicle.currentPosition)
      ) {
        occupied.add(vehicle.currentPosition);
      }
    }

    const inFlight = new Map<string, number>();
    for (const [vehicleName, target] of this.chargeTargets) {
      const position = this.vehicleStore.get(vehicleName)?.currentPosition;
      if (position && chargePoints.has(position)) continue;
      inFlight.set(target.location, (inFlight.get(target.location) ?? 0) + 1);
    }

    const free = new Map<string, number>();
    for (const loc of locations) {
      const occ = loc.points.filter((point) => occupied.has(point)).length;
      free.set(
        loc.name,
        loc.points.length - occ - (inFlight.get(loc.name) ?? 0),
      );
    }
    return free;
  }

  private async reconcileChargeTargets(
    chargePoints: ReadonlySet<string>,
  ): Promise<void> {
    for (const [vehicleName, target] of [...this.chargeTargets]) {
      const state = this.vehicleStore.get(vehicleName);
      if (state?.currentPosition && chargePoints.has(state.currentPosition)) {
        this.chargeTargets.delete(vehicleName);
        continue;
      }
      if (state?.transportOrder === target.order) continue;
      const orderState = await this.kernelApi.getTransportOrderState(
        target.order,
      );
      if (orderState === null || TERMINAL_ORDER_STATES.has(orderState)) {
        this.chargeTargets.delete(vehicleName);
      }
    }
  }

  private hasInFlightCharge(
    vehicleName: string,
    chargePoints: ReadonlySet<string>,
  ): boolean {
    const target = this.chargeTargets.get(vehicleName);
    if (!target) return false;
    const position = this.vehicleStore.get(vehicleName)?.currentPosition;
    if (position && chargePoints.has(position)) {
      this.chargeTargets.delete(vehicleName);
      return false;
    }
    return true;
  }

  private async createChargeOrder(
    vehicleName: string,
    locationName: string,
  ): Promise<void> {
    const orderName = buildOrderName(
      ORDER_TYPE.CHARGE,
      vehicleName,
      locationName,
      randomUUID(),
    );
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName, operation: this.kernelApi.chargeOperation }],
        vehicleName,
        { [ORDER_PROP.LEG]: CHARGE_LEG },
      );
      this.chargeTargets.set(vehicleName, {
        location: locationName,
        order: orderName,
      });
      this.logger.log(
        `Charging ${vehicleName} → ${locationName} (${orderName})`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to charge ${vehicleName}: ${(err as Error).message}`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  CHARGE_ORDER_PREFIX,
  PARK_ORDER_PREFIX,
  ORDER_PROP,
} from './domain/events';
import { AgvEntity } from '../agvs/entities/agv.entity';
import { KernelApiService } from '../opentcs/kernel-api.service';
import type { KernelVehicleState } from '../opentcs/kernel-api.service';
import { VehicleStateStore } from '../opentcs/vehicle-state.store';
import { RoutingService } from './routing.service';
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

const CHARGE_LEG = 'CHARGE';
const PARK_LEG = 'PARK';
const STOP_CHARGING_ACTION = 'stopCharging';
const DEFAULT_FULL_CHARGE_PCT = 85;

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
  private readonly releaseTargets = new Map<
    string,
    { point: string; order: string }
  >();
  private readonly parkTargets = new Map<
    string,
    { point: string; order: string }
  >();
  private readonly fullChargePct: number;

  constructor(
    @InjectRepository(AgvEntity)
    private readonly agvRepo: Repository<AgvEntity>,
    private readonly kernelApi: KernelApiService,
    private readonly vehicleStore: VehicleStateStore,
    private readonly routing: RoutingService,
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

    const agvs = await this.agvRepo.find();
    const parkingPoints = await this.kernelApi.getParkingPoints();
    const parkPointNames = new Set(parkingPoints.map((p) => p.name));
    const nonChargeParks = parkingPoints.filter(
      (p) => !chargePoints.has(p.name),
    );

    await this.releaseCharged(agvs, nonChargeParks);
    await this.dispatchToCharge(
      agvs,
      locations,
      chargePoints,
      nonChargeParks,
      parkPointNames,
    );
  }

  private toCandidate(
    agv: AgvEntity,
    fms: KernelVehicleState | undefined,
  ): ChargeVehicleCandidate {
    return {
      name: agv.name,
      dispatchEnabled: agv.isDispatchEnabled,
      ignored: agv.isIgnored,
      idleAvailable: isIdleAvailable(fms),
      charging: fms?.state === 'CHARGING',
      onOrder: fms?.transportOrder != null,
      currentPosition: fms?.currentPosition ?? null,
      energyLevel: fms?.energyLevel ?? 0,
      criticalThreshold: agv.criticalBatteryThreshold,
      sufficientThreshold: agv.sufficientBatteryThreshold,
    };
  }

  private async releaseCharged(
    agvs: AgvEntity[],
    nonChargeParks: readonly ParkingPoint[],
  ): Promise<void> {
    const releasable = agvs
      .map((agv) => ({
        agv,
        cand: this.toCandidate(agv, this.vehicleStore.get(agv.name)),
      }))
      .filter(
        ({ agv, cand }) =>
          isReleaseCandidate(cand) &&
          !this.hasInFlightRelease(agv.name, cand.charging),
      );
    if (releasable.length === 0) return;

    const toRelease = releasable.filter(({ cand }) =>
      shouldRelease(cand, this.fullChargePct),
    );
    if (toRelease.length === 0) return;

    const graph = await this.routing.getRoadGraph();
    const excluded = this.occupiedPoints(agvs, nonChargeParks);
    for (const target of this.releaseTargets.values()) {
      excluded.add(target.point);
    }

    for (const { agv, cand } of toRelease) {
      const position = cand.currentPosition;
      if (!position) continue;
      const distances = graph
        ? shortestDistancesFrom(graph, position)
        : new Map<string, number>();
      const point = pickParkingPoint(nonChargeParks, distances, excluded);
      if (!point) {
        this.logger.debug(
          `No free non-charge park for ${agv.name} — staying on charger`,
        );
        continue;
      }
      excluded.add(point.name);
      await this.releaseChargeOrder(agv.name, point.name);
    }
  }

  private hasInFlightRelease(vehicleName: string, charging: boolean): boolean {
    if (!this.releaseTargets.has(vehicleName)) return false;
    if (!charging) {
      this.releaseTargets.delete(vehicleName);
      return false;
    }
    return true;
  }

  private async releaseChargeOrder(
    vehicleName: string,
    pointName: string,
  ): Promise<void> {
    const orderName = `${PARK_ORDER_PREFIX}${randomUUID()}`;
    try {
      await this.kernelApi.sendInstantAction(vehicleName, STOP_CHARGING_ACTION);
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: pointName, operation: 'MOVE' }],
        vehicleName,
        { [ORDER_PROP.LEG]: PARK_LEG },
      );
      this.releaseTargets.set(vehicleName, {
        point: pointName,
        order: orderName,
      });
      this.logger.log(`Released ${vehicleName} from charge → ${pointName}`);
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
  ): Promise<void> {
    const readyToCharge: Array<{ name: string; position: string }> = [];
    for (const agv of agvs) {
      const cand = this.toCandidate(agv, this.vehicleStore.get(agv.name));
      if (!needsCharging(cand, chargePoints)) continue;
      if (this.hasInFlightCharge(agv.name, chargePoints)) continue;
      if (this.hasInFlightPark(agv.name)) continue;
      if (cand.currentPosition == null) continue;
      readyToCharge.push({ name: agv.name, position: cand.currentPosition });
    }
    if (readyToCharge.length === 0) return;

    const freeSlots = this.freeSlotsByLocation(locations, chargePoints);
    const graph = await this.routing.getRoadGraph();
    const parkExcluded = this.occupiedPoints(agvs, nonChargeParks);
    for (const target of this.parkTargets.values()) {
      parkExcluded.add(target.point);
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

      if (parkPointNames.has(position)) continue;
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

  private hasInFlightPark(vehicleName: string): boolean {
    const target = this.parkTargets.get(vehicleName);
    if (!target) return false;
    if (this.vehicleStore.get(vehicleName)?.currentPosition === target.point) {
      this.parkTargets.delete(vehicleName);
      return false;
    }
    return true;
  }

  private async parkForNoSlot(
    vehicleName: string,
    pointName: string,
  ): Promise<void> {
    const orderName = `${PARK_ORDER_PREFIX}${randomUUID()}`;
    try {
      await this.kernelApi.createTransportOrder(
        orderName,
        [{ locationName: pointName, operation: 'MOVE' }],
        vehicleName,
        { [ORDER_PROP.LEG]: PARK_LEG },
      );
      this.parkTargets.set(vehicleName, { point: pointName, order: orderName });
      this.logger.log(`No charge slot — parking ${vehicleName} → ${pointName}`);
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
    const orderName = `${CHARGE_ORDER_PREFIX}${randomUUID()}`;
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

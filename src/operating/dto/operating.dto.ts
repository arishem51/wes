/**
 * Response shapes for the operating screen (`wes-new-client-v2`). These mirror the DTOs the
 * v2 client already consumes (ported 1:1 from the retired `wes-new` backend) so the client
 * needs no type changes — only its API base URL moves to `/api/operating/*`.
 */

export interface PlantModelPointDto {
  name: string;
  x: number;
  y: number;
  linked: boolean;
  /** openTCS Point.Type — HALT_POSITION / PARK_POSITION / REPORT_POSITION. */
  type: string;
  labelOffsetX: number;
  labelOffsetY: number;
  /** Fixed vehicle orientation at this point in degrees, or null ("NaN" in the model). */
  orientationAngle: number | null;
}

export interface PlantModelPathDto {
  name: string;
  source: string;
  target: string;
  locked: boolean;
  maxVelocity: number;
  maxReverseVelocity: number;
  /** true when the path may only be driven source -> target (maxReverseVelocity === 0). */
  oneWay: boolean;
}

export interface PlantModelLocationTypeDto {
  name: string;
  allowedOperations: string[];
}

export interface PlantModelPointsDto {
  modelName: string;
  points: PlantModelPointDto[];
}

export interface VehicleRealtimeDto {
  name: string;
  x: number | null;
  y: number | null;
  orientationAngle: number | null;
  currentPosition: string | null;
  state: string;
  procState: string;
  integrationLevel: string;
  energyLevel: number;
  transportOrder: string | null;
  paused: boolean;
  /** Carrying cargo — true while executing a drop-off order (`DROPOFF-*`, WES naming). */
  loaded: boolean;
  /** Point names still ahead of the vehicle on its current order — for the route highlight. */
  routePoints: string[];
}

export interface TransportOrderDto {
  name: string;
  type: string;
  state: string;
  processingVehicle: string | null;
  intendedVehicle: string | null;
  wrappingSequence: string | null;
  destinations: { locationName: string; operation: string }[];
  creationTime: string | null;
}

export interface OperatingHealthDto {
  kernel: string;
  kernelSse: { connected: boolean; eventCount: number; lastEventAt: string | null };
  db: string;
  mqtt: string;
}

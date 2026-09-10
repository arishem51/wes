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
  /** true when the point is linked to a Location whose LocationType allows the charge operation. */
  charge: boolean;
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

// --- Area (a wes Zone projected into the shape the operating client expects) ---------------

export type AreaKind = 'ZONE' | 'STORE';
export type AreaMemberState = 'FREE' | 'RESERVED' | 'OCCUPIED';

export interface AreaMemberDto {
  wesId: string;
  areaId: string;
  opentcsLocationName: string;
  opentcsPointName: string;
  priority: number;
  state: AreaMemberState;
  cargoId: string | null;
}

export interface AreaDto {
  wesId: string;
  name: string;
  kind: AreaKind;
  /** Implicit in wes (liftUp / liftDown by kind) — reported for display only. */
  operation: string;
  maxVehicles: number | null;
  color: string | null;
  plantModelName: string | null;
  status: 'ACTIVE' | 'STALE';
  members: AreaMemberDto[];
}

export interface CreateAreaBody {
  wesId?: string;
  name: string;
  kind: AreaKind;
  operation?: string;
  maxVehicles?: number;
  color?: string;
  members: { pointName: string; priority?: number }[];
}

export interface ReplaceAreaMembersBody {
  name?: string;
  members: { pointName: string; priority?: number }[];
}

export interface UpdateAreaBody {
  color?: string;
}

// --- Cargo (a wes CargoResponseDto mapped to the operating client's shape) -----------------

export type OperatingCargoStatus =
  | 'QUEUED'
  | 'BLOCKED'
  | 'PICK_PENDING'
  | 'PICKING'
  | 'CARRYING'
  | 'SHIPPING'
  | 'DONE'
  | 'FAILED';

export interface CargoDto {
  cargoId: string;
  status: OperatingCargoStatus;
  processingVehicle: string | null;
  pickupAreaWesId: string | null;
  pickupPointName: string | null;
  pickupLocationName: string | null;
  targetStoreAreaWesId: string | null;
  dropPointName: string | null;
  dropLocationName: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

export interface CreateCargoBody {
  cargoId?: string;
  pickupAreaWesId?: string;
  pickupPointName: string;
  targetStoreAreaWesId: string;
}

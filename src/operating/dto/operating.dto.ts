/**
 * Response shapes for the operating screen (`wes-new-client-v2`). These mirror the DTOs the
 * v2 client already consumes (ported 1:1 from the retired `wes-new` backend) so the client
 * needs no type changes — only its API base URL moves to `/api/operating/*`.
 *
 * Request bodies (below the response shapes) are `class`es with `class-validator` decorators —
 * unlike the response interfaces, these are actually run through the global `ValidationPipe`,
 * and being real classes is also what lets the OpenAPI/Swagger plugin document them.
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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
  /** % of the current order's route steps already driven (0 with no active order). */
  routeProgressPercent: number;
  /** Every route step in order, each flagged driven/not — for the full-route popover. */
  routeSteps: { point: string; driven: boolean }[];
  /** Resource (point/path) names currently claimed by the vehicle in the kernel scheduler. */
  allocatedResources: string[];
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
  /** Only set once the kernel actually reaches a successful FINISHED state — null otherwise. */
  finishedTime: string | null;
}

export interface OperatingHealthDto {
  kernel: string;
  kernelSse: {
    connected: boolean;
    eventCount: number;
    lastEventAt: string | null;
  };
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

export class AreaMemberInput {
  @IsString()
  pointName!: string;

  @IsOptional()
  @IsNumber()
  priority?: number;
}

export class CreateAreaBody {
  @IsOptional()
  @IsString()
  wesId?: string;

  @IsString()
  name!: string;

  @IsIn(['ZONE', 'STORE'])
  kind!: AreaKind;

  @IsOptional()
  @IsString()
  operation?: string;

  @IsOptional()
  @IsNumber()
  maxVehicles?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AreaMemberInput)
  members!: AreaMemberInput[];
}

export class ReplaceAreaMembersBody {
  @IsOptional()
  @IsString()
  name?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AreaMemberInput)
  members!: AreaMemberInput[];
}

export class UpdateAreaBody {
  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  operation?: string;

  /** `null` explicitly clears a previously-set cap; `undefined` leaves it unchanged. */
  @ValidateIf((o: UpdateAreaBody) => o.maxVehicles != null)
  @IsNumber()
  maxVehicles?: number | null;
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
  itemCode: string;
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

export interface CargoListDto {
  cargos: CargoDto[];
  total: number;
  truncated: boolean;
}

// --- Manual transport orders (OperatingCommandsController) -------------------------------

export class OrderDestinationInput {
  @IsString()
  name!: string;

  @IsString()
  operation!: string;
}

export class CreateManualOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderDestinationInput)
  destinations!: OrderDestinationInput[];

  @IsOptional()
  @IsString()
  intendedVehicle?: string;

  @IsOptional()
  @IsString()
  type?: string;
}

export class CreateCargoBody {
  @IsOptional()
  @IsString()
  cargoId?: string;

  @IsOptional()
  @IsString()
  pickupAreaWesId?: string;

  @IsString()
  pickupPointName!: string;

  @IsString()
  targetStoreAreaWesId!: string;
}

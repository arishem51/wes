import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CargoStatus } from './entities/cargo.entity';
import { TaskStatus } from './entities/transport-task.entity';
import type { DispatchMatcher } from './domain/dispatch.policy';

export class CreateCargoDto {
  @IsOptional()
  @IsString()
  itemCode?: string;

  @IsString()
  @IsNotEmpty()
  sourcePointName!: string;

  @IsString()
  @IsNotEmpty()
  destinationZoneId!: string;
}

export class ListCargosQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  taskStatus?: TaskStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export type CargoVisualState = 'AT_SOURCE' | 'ON_AGV' | 'AT_DESTINATION';

export interface CargoVisualDto {
  state: CargoVisualState;
  pointName: string | null;
  vehicleName: string | null;
}

export interface CargoResponseDto {
  id: string;
  itemCode: string;
  sourcePointName: string | null;
  sourcePickupLocationName: string | null;
  destinationLocationName: string | null;
  status: CargoStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  taskStatus: TaskStatus | null;
  assignedVehicleName: string | null;
  blockedReason: string | null;
  visual: CargoVisualDto;
}

export interface CargoListResponse {
  cargos: CargoResponseDto[];
  total: number;
  page: number;
  limit: number;
}

export interface CargoAssignmentAlternativeDto {
  matcher: DispatchMatcher;
  vehicleName: string | null;
  distanceToSource: number | null;
}

export interface CargoAssignmentDecisionDto {
  cargoId: string;
  taskId: string;
  decidedAt: Date;
  vehicleName: string | null;
  matcher: DispatchMatcher | null;
  matchedRequestCount: number | null;
  distanceToSource: number | null;
  approachDistance: number | null;
  alternative: CargoAssignmentAlternativeDto | null;
}

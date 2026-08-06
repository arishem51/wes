import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { TaskStatus } from '../../cargo/entities/transport-task.entity';
import type { VehicleErrorEventKind } from '../entities/vehicle-error-event.entity';

export class CreateAgvDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsBoolean()
  isDispatchEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  criticalBatteryThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  sufficientBatteryThreshold?: number;

  @IsOptional()
  @IsString()
  initialPosition?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateAgvDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  criticalBatteryThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  sufficientBatteryThreshold?: number;

  @IsOptional()
  @IsString()
  initialPosition?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class ListAgvsQueryDto {
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

  @IsOptional()
  @IsString()
  search?: string;
}

export class AgvHistoryQueryDto {
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

export class AgvTaskHistoryQueryDto extends AgvHistoryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export const AGV_ERROR_WINDOWS = ['24h', '7d', '30d'] as const;

export type AgvErrorWindow = (typeof AGV_ERROR_WINDOWS)[number];

export const DEFAULT_AGV_ERROR_WINDOW: AgvErrorWindow = '7d';

export class AgvErrorFrequencyQueryDto {
  @IsOptional()
  @IsIn(AGV_ERROR_WINDOWS)
  window?: AgvErrorWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export type AgvKernelStatus =
  | 'connected'
  | 'reachable'
  | 'unreachable'
  | 'unknown';

export type AgvAcceptanceStatus = 'ENABLED' | 'DISABLED' | 'IGNORED';

export interface AgvDto {
  id: string;
  code: string;
  name: string;
  model: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  isDispatchEnabled: boolean;
  isIgnored: boolean;
  acceptanceStatus: AgvAcceptanceStatus;
  criticalBatteryThreshold: number;
  sufficientBatteryThreshold: number;
  initialPosition: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  createdById: string | null;
  kernelStatus: AgvKernelStatus;
}

export interface AgvListResponse {
  agvs: AgvDto[];
  total: number;
  page: number;
  limit: number;
  kernelReachable: boolean;
}

export interface AgvTaskHistoryEntryDto {
  taskId: string;
  source: string | null;
  destination: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  status: TaskStatus;
}

export interface AgvTaskHistoryResponse {
  agvId: string;
  vehicleName: string;
  entries: AgvTaskHistoryEntryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AgvStateChangeDto {
  id: string;
  vehicleName: string;
  pointName: string | null;
  procState: string | null;
  vehicleState: string | null;
  orderName: string | null;
  occurredAt: Date;
  observedAt: Date | null;
}

export interface AgvStateLogResponse {
  agvId: string;
  vehicleName: string;
  entries: AgvStateChangeDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AgvErrorEventDto {
  id: string;
  vehicleName: string;
  kind: VehicleErrorEventKind;
  fatalErrorTypes: string[];
  warningErrorTypes: string[];
  vehicleState: string;
  pointName: string | null;
  transportOrderName: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
  observedAt: Date | null;
}

export interface AgvErrorHistoryResponse {
  agvId: string;
  vehicleName: string;
  errors: AgvErrorEventDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AgvErrorFrequencyEntry {
  agvId: string | null;
  vehicleName: string;
  errorCount: number;
  lastOccurredAt: Date;
}

export interface AgvErrorFrequencyResponse {
  window: AgvErrorWindow;
  from: Date;
  to: Date;
  vehicles: AgvErrorFrequencyEntry[];
}

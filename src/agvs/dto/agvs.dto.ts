import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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

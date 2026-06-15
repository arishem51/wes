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
  operationalBatteryThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  chargingBatteryThreshold?: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class RegisterAgvDto {
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
}

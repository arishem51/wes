import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CargoStatus } from './entities/cargo.entity';
import { TaskStatus } from './entities/transport-task.entity';

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
  visual: CargoVisualDto;
}

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ZoneType } from './entities/zone.entity';

export class ZoneMemberDto {
  @IsString()
  @IsNotEmpty()
  locationName!: string;

  @IsInt()
  @Min(0)
  positionIndex!: number;
}

export class CreateZoneDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ZoneType)
  type!: ZoneType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ZoneMemberDto)
  members!: ZoneMemberDto[];
}

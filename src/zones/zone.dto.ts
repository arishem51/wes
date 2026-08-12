import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ZoneType } from './entities/zone.entity';

/** #RGB, #RRGGBB or #RRGGBBAA hex color. */
export const HEX_COLOR_REGEX =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_REGEX, {
    message: 'color phải là mã hex hợp lệ (#RRGGBB).',
  })
  color?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ZoneMemberDto)
  members!: ZoneMemberDto[];
}

export class AssignZoneMapDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  zoneIds!: string[];
}

export class ListZonesQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allMaps?: boolean;
}

export class UpdateZoneDto {
  @IsString()
  @Matches(HEX_COLOR_REGEX, {
    message: 'color phải là mã hex hợp lệ (#RRGGBB).',
  })
  color!: string;
}

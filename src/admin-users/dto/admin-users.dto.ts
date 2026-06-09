import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const ROLES = ['admin', 'operator'] as const;
type FeRole = (typeof ROLES)[number];

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @Matches(/^[a-z0-9._]+$/, { message: 'Username chỉ gồm chữ thường, số, dấu chấm và gạch dưới.' })
  username: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsIn(ROLES)
  role: FeRole;

  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: FeRole;
}

export class SetRoleDto {
  @IsIn(ROLES)
  role: FeRole;
}

export class LockDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

import { UserEntity } from './entities/user.entity';
import type { RoleName } from './entities/role.entity';

export type FeRole = 'admin' | 'operator';
export type UserStatus = 'active' | 'locked' | 'invited' | 'inactive';

export interface AccountUserDto {
  name: string;
  username: string;
  email: string;
  phone: string;
  shift: string;
  role: FeRole;
  photo: string | null;
  created: string;
}

export interface AdminUserDto {
  id: string;
  name: string;
  username: string;
  email: string;
  role: FeRole;
  status: UserStatus;
  phone: string;
  shift: string;
  online: boolean;
  lastActive: string | null;
  created: string;
  lockReason: string | null;
}

export const roleToFe = (name: RoleName): FeRole =>
  name.toLowerCase() as FeRole;
export const roleToDb = (role: FeRole): RoleName =>
  role.toUpperCase() as RoleName;

export function deriveStatus(u: UserEntity): UserStatus {
  if (u.isLocked) return 'locked';
  if (u.isInvited) return 'invited';
  if (u.isActive) return 'active';
  return 'inactive';
}

export function toAccountUser(u: UserEntity, role: FeRole): AccountUserDto {
  return {
    name: u.fullName,
    username: u.username,
    email: u.email,
    phone: u.phone ?? '',
    shift: u.shift ?? '',
    role,
    photo: u.avatarUrl,
    created: u.createdAt.toISOString(),
  };
}

export function toAdminUser(
  u: UserEntity,
  role: FeRole,
  online: boolean,
): AdminUserDto {
  return {
    id: u.id,
    name: u.fullName,
    username: u.username,
    email: u.email,
    role,
    status: deriveStatus(u),
    phone: u.phone ?? '',
    shift: u.shift ?? '',
    online,
    lastActive: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    created: u.createdAt.toISOString(),
    lockReason: u.lockReason ?? null,
  };
}

// Domain types for FE-07 User & Access Management.

export type Role = 'admin' | 'operator';
export const ROLES: Role[] = ['admin', 'operator'];

export type UserStatus = 'active' | 'locked' | 'invited' | 'inactive';
export const STATUSES: UserStatus[] = ['active', 'locked', 'invited', 'inactive'];

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  status: UserStatus;
  phone: string;
  shift: string;
  mfa: boolean;
  online: boolean;
  lastActive: string | null;
  lastLogin: string | null;
  created: string;
  lockReason?: string | null;
}

/** Payload to create a user (UC-81). */
export interface CreateUserInput {
  name: string;
  username: string;
  email: string;
  phone: string;
  shift: string;
  role: Role;
  sendInvite: boolean;
}

/** Editable profile fields (UC-82). */
export interface UpdateUserInput {
  name?: string;
  email?: string;
  phone?: string;
  shift?: string;
  role?: Role;
}

export type PermLevel = 'full' | 'view' | 'none';
export type PermGroup =
  | 'pg_fleet'
  | 'pg_map'
  | 'pg_requests'
  | 'pg_dispatch'
  | 'pg_dashboard'
  | 'pg_users'
  | 'pg_audit';

export interface ListUsersParams {
  search?: string;
  status?: UserStatus | 'all';
  role?: Role | 'all';
}

export interface ActivityEntry {
  at: string;
  action: string;
  text: { vi: string; en: string };
}

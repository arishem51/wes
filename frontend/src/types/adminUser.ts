// Admin User Management types (sidebar "Users & Access").
import type { Role } from './account';

export type { Role };
export const ADMIN_ROLES: Role[] = ['admin', 'operator'];

export type AdminUserStatus = 'active' | 'locked' | 'invited' | 'inactive';
export const ADMIN_STATUSES: AdminUserStatus[] = ['active', 'locked', 'invited', 'inactive'];

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  status: AdminUserStatus;
  phone: string;
  shift: string;
  online: boolean;
  lastActive: string | null;
  created: string;
  lockReason?: string | null;
}

export interface CreateAdminUserInput {
  name: string;
  username: string;
  email: string;
  phone: string;
  shift: string;
  role: Role;
  sendInvite: boolean;
}

export interface UpdateAdminUserInput {
  name?: string;
  email?: string;
  phone?: string;
  shift?: string;
  role?: Role;
}

export type PermLevel = 'full' | 'view' | 'none';
export type PermGroup = 'pg_fleet' | 'pg_map' | 'pg_requests' | 'pg_dispatch' | 'pg_dashboard' | 'pg_users' | 'pg_audit';

export interface AdminListParams {
  search?: string;
  role?: Role | 'all';
  status?: AdminUserStatus | 'all';
}

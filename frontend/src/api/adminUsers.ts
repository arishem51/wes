import { apiClient } from './client';
import type {
  AdminListParams,
  AdminUser,
  CreateAdminUserInput,
  Role,
  UpdateAdminUserInput,
} from '@/types/adminUser';

/**
 * Admin User Management API (sidebar "Users & Access").
 *
 * Distinct from the account self-service API: these endpoints manage *other*
 * users and require admin privileges.
 */
export const adminUsersApi = {
  list(params: AdminListParams = {}): Promise<AdminUser[]> {
    return apiClient.get<AdminUser[]>('/admin/users', { params }).then((r) => r.data);
  },
  create(input: CreateAdminUserInput): Promise<AdminUser> {
    return apiClient.post<AdminUser>('/admin/users', input).then((r) => r.data);
  },
  update(id: string, input: UpdateAdminUserInput): Promise<AdminUser> {
    return apiClient.patch<AdminUser>(`/admin/users/${id}`, input).then((r) => r.data);
  },
  remove(id: string): Promise<AdminUser> {
    return apiClient.delete<AdminUser>(`/admin/users/${id}`).then((r) => r.data);
  },
  setRole(id: string, role: Role): Promise<AdminUser> {
    return apiClient.put<AdminUser>(`/admin/users/${id}/role`, { role }).then((r) => r.data);
  },
  lock(id: string, reason?: string): Promise<AdminUser> {
    return apiClient.post<AdminUser>(`/admin/users/${id}/lock`, { reason }).then((r) => r.data);
  },
  unlock(id: string): Promise<AdminUser> {
    return apiClient.post<AdminUser>(`/admin/users/${id}/unlock`).then((r) => r.data);
  },
  activate(id: string): Promise<AdminUser> {
    return apiClient.post<AdminUser>(`/admin/users/${id}/activate`).then((r) => r.data);
  },
  resetPassword(id: string): Promise<void> {
    return apiClient.post(`/admin/users/${id}/reset-password`).then(() => undefined);
  },
};

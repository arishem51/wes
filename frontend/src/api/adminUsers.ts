import { apiClient, USE_MOCK } from './client';
import { mockAdminUsersApi } from '@/mocks/adminUsers';
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
 * users and require admin privileges. Mock-backed when VITE_USE_MOCK=true.
 */
export const adminUsersApi = {
  list(params: AdminListParams = {}): Promise<AdminUser[]> {
    if (USE_MOCK) return mockAdminUsersApi.list(params);
    return apiClient.get<AdminUser[]>('/admin/users', { params }).then((r) => r.data);
  },
  create(input: CreateAdminUserInput): Promise<AdminUser> {
    if (USE_MOCK) return mockAdminUsersApi.create(input);
    return apiClient.post<AdminUser>('/admin/users', input).then((r) => r.data);
  },
  update(id: string, input: UpdateAdminUserInput): Promise<AdminUser> {
    if (USE_MOCK) return mockAdminUsersApi.update(id, input);
    return apiClient.patch<AdminUser>(`/admin/users/${id}`, input).then((r) => r.data);
  },
  remove(id: string): Promise<void> {
    if (USE_MOCK) return mockAdminUsersApi.remove(id);
    return apiClient.delete(`/admin/users/${id}`).then(() => undefined);
  },
  setRole(id: string, role: Role): Promise<AdminUser> {
    if (USE_MOCK) return mockAdminUsersApi.setRole(id, role);
    return apiClient.put<AdminUser>(`/admin/users/${id}/role`, { role }).then((r) => r.data);
  },
  lock(id: string, reason?: string): Promise<AdminUser> {
    if (USE_MOCK) return mockAdminUsersApi.setLock(id, true, reason);
    return apiClient.post<AdminUser>(`/admin/users/${id}/lock`, { reason }).then((r) => r.data);
  },
  unlock(id: string): Promise<AdminUser> {
    if (USE_MOCK) return mockAdminUsersApi.setLock(id, false);
    return apiClient.post<AdminUser>(`/admin/users/${id}/unlock`).then((r) => r.data);
  },
  resetPassword(id: string): Promise<void> {
    if (USE_MOCK) return mockAdminUsersApi.resetPassword(id);
    return apiClient.post(`/admin/users/${id}/reset-password`).then(() => undefined);
  },
};

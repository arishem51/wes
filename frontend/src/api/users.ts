import { apiClient, USE_MOCK } from './client';
import { mockUsersApi } from '@/mocks/users';
import type {
  CreateUserInput,
  ListUsersParams,
  Role,
  UpdateUserInput,
  User,
} from '@/types/user';

/**
 * User & Access Management API (FE-07, UC-81 → UC-90).
 *
 * Each method maps to a REST endpoint on the WES NestJS backend. When
 * VITE_USE_MOCK=true the calls are served from an in-memory dataset so the
 * module can run standalone.
 */
export const usersApi = {
  // UC-84 List users.
  list(params: ListUsersParams = {}): Promise<User[]> {
    if (USE_MOCK) return mockUsersApi.list(params);
    return apiClient.get<User[]>('/users', { params }).then((res) => res.data);
  },

  // UC-81 Create user.
  create(input: CreateUserInput): Promise<User> {
    if (USE_MOCK) return mockUsersApi.create(input);
    return apiClient.post<User>('/users', input).then((res) => res.data);
  },

  // UC-82 Update user.
  update(id: string, input: UpdateUserInput): Promise<User> {
    if (USE_MOCK) return mockUsersApi.update(id, input);
    return apiClient.patch<User>(`/users/${id}`, input).then((res) => res.data);
  },

  // UC-83 Delete user.
  remove(id: string): Promise<void> {
    if (USE_MOCK) return mockUsersApi.remove(id);
    return apiClient.delete(`/users/${id}`).then(() => undefined);
  },

  // UC-88 / UC-89 Assign / change role.
  setRole(id: string, role: Role): Promise<User> {
    if (USE_MOCK) return mockUsersApi.setRole(id, role);
    return apiClient.put<User>(`/users/${id}/role`, { role }).then((res) => res.data);
  },

  // UC-86 Lock account.
  lock(id: string, reason?: string): Promise<User> {
    if (USE_MOCK) return mockUsersApi.setLock(id, true, reason);
    return apiClient.post<User>(`/users/${id}/lock`, { reason }).then((res) => res.data);
  },

  // UC-87 Unlock account.
  unlock(id: string): Promise<User> {
    if (USE_MOCK) return mockUsersApi.setLock(id, false);
    return apiClient.post<User>(`/users/${id}/unlock`).then((res) => res.data);
  },

  // UC-90 Reset password.
  resetPassword(id: string, method: 'link' | 'temp', force: boolean): Promise<void> {
    if (USE_MOCK) return mockUsersApi.resetPassword(id);
    return apiClient.post(`/users/${id}/reset-password`, { method, force }).then(() => undefined);
  },
};

import { apiClient, USE_MOCK } from './client';
import { mockAuthApi } from '@/mocks/account';
import type { AccountUser } from '@/types/account';

const TOKEN_KEY = 'wes.accessToken';
const AUTH_KEY = 'wes-auth';

/**
 * Authentication API (FE-07).
 *
 * UC-81 login, UC-82 logout, UC-86 forgot password. With VITE_USE_MOCK=true the
 * flows are served from an in-memory stub; otherwise they hit the WES backend.
 */
export const authApi = {
  isAuthenticated(): boolean {
    try {
      return localStorage.getItem(AUTH_KEY) === '1';
    } catch {
      return false;
    }
  },

  // UC-81 — sign in.
  async login(username: string, password: string): Promise<AccountUser> {
    const res = USE_MOCK
      ? await mockAuthApi.login(username)
      : (await apiClient.post<{ token: string; user: AccountUser }>('/auth/login', { username, password })).data;
    try {
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(AUTH_KEY, '1');
    } catch {
      /* ignore */
    }
    return res.user;
  },

  // UC-82 — sign out.
  async logout(): Promise<void> {
    try {
      if (!USE_MOCK) await apiClient.post('/auth/logout');
      else await mockAuthApi.logout();
    } finally {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(AUTH_KEY);
      } catch {
        /* ignore */
      }
    }
  },

  // UC-86 — request password reset link.
  forgotPassword(email: string): Promise<void> {
    if (USE_MOCK) return mockAuthApi.forgotPassword(email);
    return apiClient.post('/auth/forgot-password', { email }).then(() => undefined);
  },
};

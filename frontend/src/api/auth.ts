import { apiClient } from './client';
import type { AccountUser } from '@/types/account';

const TOKEN_KEY = 'wes.accessToken';
const AUTH_KEY = 'wes-auth';

function clearStoredAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Authentication API (FE-07).
 *
 * UC-81 login, UC-82 logout, UC-86 forgot password — against the WES backend.
 */
export const authApi = {
  isAuthenticated(): boolean {
    try {
      return localStorage.getItem(AUTH_KEY) === '1' && Boolean(localStorage.getItem(TOKEN_KEY));
    } catch {
      return false;
    }
  },

  clearSession: clearStoredAuth,

  // UC-81 — sign in.
  async login(username: string, password: string): Promise<AccountUser> {
    const res = (
      await apiClient.post<{ token: string; user: AccountUser }>('/auth/login', { username, password })
    ).data;
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
      await apiClient.post('/auth/logout');
    } finally {
      clearStoredAuth();
    }
  },

  // UC-86 — request password reset link.
  forgotPassword(email: string): Promise<void> {
    return apiClient.post('/auth/forgot-password', { email }).then(() => undefined);
  },

  resetPassword(token: string, newPassword: string): Promise<void> {
    return apiClient.post('/auth/reset-password', { token, newPassword }).then(() => undefined);
  },
};

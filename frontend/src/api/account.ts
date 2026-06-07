import { apiClient, USE_MOCK } from './client';
import { mockAccountApi } from '@/mocks/account';
import type { AccountUser, UpdateProfileInput } from '@/types/account';

/**
 * Account self-service API (FE-07).
 *
 * UC-83 view profile, UC-84 update profile, UC-85 change password.
 */
export const accountApi = {
  // UC-83 — current user's profile.
  getProfile(): Promise<AccountUser> {
    if (USE_MOCK) return mockAccountApi.getProfile();
    return apiClient.get<AccountUser>('/account/me').then((res) => res.data);
  },

  // UC-84 — update own profile.
  updateProfile(patch: UpdateProfileInput): Promise<AccountUser> {
    if (USE_MOCK) return mockAccountApi.updateProfile(patch);
    return apiClient.patch<AccountUser>('/account/me', patch).then((res) => res.data);
  },

  // UC-85 — change password.
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (USE_MOCK) return mockAccountApi.changePassword();
    return apiClient
      .post('/account/change-password', { currentPassword, newPassword })
      .then(() => undefined);
  },

  // Sign out all other active sessions.
  signOutOthers(): Promise<void> {
    if (USE_MOCK) return mockAccountApi.signOutOthers();
    return apiClient.post('/account/sessions/revoke-others').then(() => undefined);
  },
};

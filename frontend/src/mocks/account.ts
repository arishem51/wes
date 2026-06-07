import type { AccountUser, UpdateProfileInput } from '@/types/account';

export const DEFAULT_USER: AccountUser = {
  name: 'Trần Minh Quân',
  username: 'quan.tran',
  email: 'quan.tran@wes.vn',
  phone: '0901 234 567',
  shift: 'Hành chính · Điều phối',
  role: 'admin',
  photo: null,
  created: '2024-02-12',
};

let current: AccountUser = { ...DEFAULT_USER };

const delay = (ms = 280) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockAuthApi = {
  async login(username: string): Promise<{ token: string; user: AccountUser }> {
    await delay(650);
    current = {
      ...DEFAULT_USER,
      username,
      name: username === DEFAULT_USER.username ? DEFAULT_USER.name : current.name,
    };
    return { token: 'mock-token-' + Math.random().toString(36).slice(2), user: { ...current } };
  },
  async logout(): Promise<void> {
    await delay(120);
  },
  async forgotPassword(_email: string): Promise<void> {
    await delay(400);
  },
};

export const mockAccountApi = {
  async getProfile(): Promise<AccountUser> {
    await delay(150);
    return { ...current };
  },
  async updateProfile(patch: UpdateProfileInput): Promise<AccountUser> {
    await delay();
    current = { ...current, ...patch };
    return { ...current };
  },
  async changePassword(): Promise<void> {
    await delay();
  },
  async signOutOthers(): Promise<void> {
    await delay();
  },
};

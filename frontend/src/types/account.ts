// Domain types for FE-07 Account & Access (UC-81 → UC-86).

export type Role = 'admin' | 'operator';

export interface AccountUser {
  name: string;
  username: string;
  email: string;
  phone: string;
  shift: string;
  role: Role;
  photo: string | null;
  created: string;
}

export interface Prefs {
  notif: boolean;
  sound: boolean;
}

export interface LoginInput {
  username: string;
  password: string;
  remember: boolean;
}

export interface UpdateProfileInput {
  name?: string;
  email?: string;
  phone?: string;
  shift?: string;
  photo?: string | null;
}

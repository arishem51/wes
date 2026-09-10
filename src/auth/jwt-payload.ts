import type { FeRole } from '../users/user.mapper';

export interface JwtPayload {
  sub: string;
  username: string;
  roles: FeRole[];
}

export type AuthUser = JwtPayload;

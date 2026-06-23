import type { FeRole } from '../users/user.mapper';

export interface JwtPayload {
  sub: string;
  username: string;
  roles: FeRole[];
}

/** Shape attached to `request.user` after JWT validation. */
export type AuthUser = JwtPayload;

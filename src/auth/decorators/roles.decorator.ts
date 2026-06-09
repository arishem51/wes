import { SetMetadata } from '@nestjs/common';
import type { FeRole } from '../../users/user.mapper';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: FeRole[]) => SetMetadata(ROLES_KEY, roles);

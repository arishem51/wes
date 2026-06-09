import type { PermGroup, PermLevel, Role } from '@/types/adminUser';

/**
 * Static role → permission matrix used only to render the "Permissions" tab.
 * This is reference data (mirrors backend role policy), not mock user data.
 */
export const PERMISSIONS: Record<Role, Record<PermGroup, PermLevel>> = {
  admin: {
    pg_fleet: 'full',
    pg_map: 'full',
    pg_requests: 'full',
    pg_dispatch: 'full',
    pg_dashboard: 'full',
    pg_users: 'full',
    pg_audit: 'full',
  },
  operator: {
    pg_fleet: 'view',
    pg_map: 'view',
    pg_requests: 'full',
    pg_dispatch: 'none',
    pg_dashboard: 'view',
    pg_users: 'none',
    pg_audit: 'view',
  },
};

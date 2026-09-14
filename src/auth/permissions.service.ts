import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { RoleEntity } from '../users/entities/role.entity';
import { RolePermissionEntity } from '../users/entities/role-permission.entity';
import { ApiTokenEntity } from '../users/entities/api-token.entity';
import { UsersService } from '../users/users.service';
import { IMPLICIT_VIEW_PERMISSIONS } from './permission.catalogue';
import type { AuthUser } from './jwt-payload';

const STALE_LAST_USED_MS = 5 * 60_000;

/**
 * Resolves a role key to its effective permission set, cached in memory and invalidated
 * whenever a role or the matrix changes (`refresh()`), so an admin's edit takes effect on the
 * very next request without re-issuing tokens. Also gates both kinds of permanent token
 * (system-generated `jti` JWTs and pasted opaque strings looked up by hash).
 */
@Injectable()
export class PermissionsService {
  private cache = new Map<string, Set<string>>();

  constructor(
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissions: Repository<RolePermissionEntity>,
    @InjectRepository(ApiTokenEntity)
    private readonly apiTokens: Repository<ApiTokenEntity>,
    private readonly users: UsersService,
  ) {}

  /** Drop the cache — call after any role / role_permissions mutation. */
  refresh(): void {
    this.cache.clear();
  }

  /** Effective permissions for a role key (grants ∪ implicit read permissions). */
  async getRolePermissions(roleKey: string | null | undefined): Promise<Set<string>> {
    const key = roleKey ?? '';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const perms = new Set<string>(IMPLICIT_VIEW_PERMISSIONS);
    if (key) {
      const role = await this.roles.findOne({ where: { key } });
      if (role) {
        const rows = await this.rolePermissions.find({
          where: { roleId: role.id },
        });
        rows.forEach((r) => perms.add(r.permissionKey));
      }
    }
    this.cache.set(key, perms);
    return perms;
  }

  async hasPermission(roleKey: string | null | undefined, permission: string): Promise<boolean> {
    return (await this.getRolePermissions(roleKey)).has(permission);
  }

  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * For a system-generated permanent token: confirm the `jti` row exists and is not revoked.
   * Returns the owning userId, or null if the token should be rejected. Bumps `last_used_at`
   * at most once every few minutes.
   */
  async resolveApiToken(jti: string): Promise<string | null> {
    const row = await this.apiTokens.findOne({ where: { jti } });
    if (!row || row.revokedAt) return null;
    await this.touchLastUsed(row);
    return row.userId;
  }

  async isTokenHashTaken(hash: string): Promise<boolean> {
    return (await this.apiTokens.count({ where: { tokenHash: hash } })) > 0;
  }

  /**
   * For a pasted opaque token: look it up by hash, confirm the owning account can still
   * authenticate, and resolve a ready-to-use `AuthUser` — the guard sets this on the request
   * directly, bypassing JWT verification entirely (there is no JWT to verify).
   */
  async resolveAuthUserForApiKey(rawToken: string): Promise<AuthUser | null> {
    const row = await this.apiTokens.findOne({ where: { tokenHash: this.hashToken(rawToken) } });
    if (!row || row.revokedAt) return null;

    const auth = await this.users.authStateOf(row.userId);
    if (!auth || auth.isLocked || (!auth.isActive && !auth.isInvited)) return null;

    const user = await this.users.findByIdOrFail(row.userId);
    const role = this.users.feRoleOf(user);
    const perms = await this.getRolePermissions(role);
    await this.touchLastUsed(row);

    return {
      sub: row.userId,
      username: user.username,
      role,
      roles: [role],
      perms: [...perms],
      mustChangePassword: false,
    };
  }

  private async touchLastUsed(row: ApiTokenEntity): Promise<void> {
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > STALE_LAST_USED_MS) {
      await this.apiTokens.update({ id: row.id }, { lastUsedAt: new Date() });
    }
  }
}

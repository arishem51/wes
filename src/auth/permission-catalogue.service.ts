import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionEntity } from '../users/entities/permission.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { RolePermissionEntity } from '../users/entities/role-permission.entity';
import {
  PERMISSION_CATALOGUE,
  SYSTEM_ROLE_GRANTS,
} from './permission.catalogue';

/**
 * Keeps the `permissions` table in sync with the code catalogue on every boot, and seeds the
 * baseline grants for the system roles the first time they have none — so a fresh database is
 * usable and later UI edits to those roles are never clobbered.
 */
@Injectable()
export class PermissionCatalogueService implements OnModuleInit {
  private readonly logger = new Logger(PermissionCatalogueService.name);

  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissions: Repository<PermissionEntity>,
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissions: Repository<RolePermissionEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncCatalogue();
      await this.seedSystemGrants();
    } catch (error) {
      // DB may not be ready at boot in some environments; the migration + `npm run seed`
      // path still covers a fresh install.
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Permission catalogue sync skipped: ${detail}`);
    }
  }

  /** Upsert every catalogue row; drop rows whose key was removed from code. */
  async syncCatalogue(): Promise<void> {
    const rows = PERMISSION_CATALOGUE.map((p, index) => ({
      key: p.key,
      cluster: p.cluster,
      isDangerous: !!p.dangerous,
      sort: index,
      labelVi: p.labelVi,
      labelEn: p.labelEn,
      labelJa: p.labelJa,
    }));
    await this.permissions.upsert(rows, ['key']);

    const known = new Set(rows.map((r) => r.key));
    const existing = await this.permissions.find();
    const stale = existing.filter((p) => !known.has(p.key)).map((p) => p.key);
    if (stale.length) {
      await this.permissions.delete(stale);
      this.logger.log(`Removed ${stale.length} stale permission(s): ${stale.join(', ')}`);
    }
    this.logger.log(`Permission catalogue: ${rows.length} key(s) ensured.`);
  }

  /** For each system role with zero grants, apply its baseline set from the catalogue. */
  async seedSystemGrants(): Promise<void> {
    for (const [key, grantKeys] of Object.entries(SYSTEM_ROLE_GRANTS)) {
      const role = await this.roles.findOne({ where: { key } });
      if (!role) continue;

      if (key === 'admin') {
        // The superuser role always mirrors the full catalogue as it grows.
        await this.setRolePermissions(role.id, grantKeys);
        continue;
      }

      const count = await this.rolePermissions.count({
        where: { roleId: role.id },
      });
      if (count === 0) {
        await this.setRolePermissions(role.id, grantKeys);
        this.logger.log(`Seeded ${grantKeys.length} grant(s) for role "${key}".`);
      }
    }
  }

  private async setRolePermissions(
    roleId: number,
    keys: string[],
  ): Promise<void> {
    const catalogueKeys = new Set(PERMISSION_CATALOGUE.map((p) => p.key));
    const valid = [...new Set(keys)].filter((k) => catalogueKeys.has(k));
    await this.rolePermissions.delete({ roleId });
    if (valid.length) {
      await this.rolePermissions.insert(
        valid.map((permissionKey) => ({ roleId, permissionKey })),
      );
    }
  }
}

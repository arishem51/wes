import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleEntity } from '../users/entities/role.entity';
import { RolePermissionEntity } from '../users/entities/role-permission.entity';
import { UserRoleEntity } from '../users/entities/user-role.entity';
import { PermissionsService } from '../auth/permissions.service';
import {
  PERMISSION_CATALOGUE,
  type PermissionCluster,
} from '../auth/permission.catalogue';
import type { CreateRoleDto, UpdateRoleDto } from './dto/rbac.dto';

export interface RoleDto {
  id: number;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

const CATALOGUE_KEYS = new Set(PERMISSION_CATALOGUE.map((p) => p.key));
const MANAGER_KEYS = ['users.manage', 'roles.manage'];

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissions: Repository<RolePermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoles: Repository<UserRoleEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  catalogue(): {
    clusters: PermissionCluster[];
    permissions: {
      key: string;
      cluster: PermissionCluster;
      dangerous: boolean;
      labelVi: string;
      labelEn: string;
      labelJa: string;
    }[];
  } {
    const clusters: PermissionCluster[] = [];
    for (const p of PERMISSION_CATALOGUE) {
      if (!clusters.includes(p.cluster)) clusters.push(p.cluster);
    }
    return {
      clusters,
      permissions: PERMISSION_CATALOGUE.map((p) => ({
        key: p.key,
        cluster: p.cluster,
        dangerous: !!p.dangerous,
        labelVi: p.labelVi,
        labelEn: p.labelEn,
        labelJa: p.labelJa,
      })),
    };
  }

  async list(): Promise<RoleDto[]> {
    const [roles, grants, counts] = await Promise.all([
      this.roles.find({ order: { isSystem: 'DESC', name: 'ASC' } }),
      this.rolePermissions.find(),
      this.userRoles
        .createQueryBuilder('ur')
        .select('ur.role_id', 'roleId')
        .addSelect('COUNT(*)', 'count')
        .groupBy('ur.role_id')
        .getRawMany<{ roleId: number; count: string }>(),
    ]);

    const grantsByRole = new Map<number, string[]>();
    for (const g of grants) {
      const arr = grantsByRole.get(g.roleId) ?? [];
      arr.push(g.permissionKey);
      grantsByRole.set(g.roleId, arr);
    }
    const countByRole = new Map(counts.map((c) => [Number(c.roleId), Number(c.count)]));

    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: countByRole.get(r.id) ?? 0,
      permissions: (grantsByRole.get(r.id) ?? []).sort(),
    }));
  }

  async create(dto: CreateRoleDto): Promise<RoleDto> {
    const existing = await this.roles.findOne({ where: { key: dto.key } });
    if (existing) throw new ConflictException('Mã vai trò đã tồn tại.');

    const role = await this.roles.save(
      this.roles.create({
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
      }),
    );
    await this.writeGrants(role.id, dto.permissions);
    this.permissions.refresh();
    return this.oneOrFail(role.id);
  }

  async update(id: number, dto: UpdateRoleDto): Promise<RoleDto> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Không tìm thấy vai trò.');

    if (dto.permissions) {
      if (role.key === 'admin') {
        throw new BadRequestException(
          'Vai trò quản trị luôn có toàn bộ quyền — không chỉnh được ma trận.',
        );
      }
      await this.assertManagerCoverage(role.id, dto.permissions);
      await this.writeGrants(role.id, dto.permissions);
    }
    if (dto.name !== undefined || dto.description !== undefined) {
      if (dto.name !== undefined) role.name = dto.name;
      if (dto.description !== undefined) role.description = dto.description || null;
      await this.roles.save(role);
    }
    this.permissions.refresh();
    return this.oneOrFail(role.id);
  }

  async remove(id: number): Promise<void> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Không tìm thấy vai trò.');
    if (role.isSystem) {
      throw new BadRequestException('Không thể xoá vai trò hệ thống.');
    }
    const count = await this.userRoles.count({ where: { roleId: id } });
    if (count > 0) {
      throw new BadRequestException(
        `Còn ${count} người dùng đang giữ vai trò này — hãy chuyển họ sang vai trò khác trước.`,
      );
    }
    await this.rolePermissions.delete({ roleId: id });
    await this.roles.delete(id);
    this.permissions.refresh();
  }

  private async writeGrants(roleId: number, keys: string[]): Promise<void> {
    const valid = [...new Set(keys)].filter((k) => CATALOGUE_KEYS.has(k));
    const unknown = keys.filter((k) => !CATALOGUE_KEYS.has(k));
    if (unknown.length) {
      throw new BadRequestException(
        `Quyền không hợp lệ: ${unknown.join(', ')}`,
      );
    }
    await this.rolePermissions.delete({ roleId });
    if (valid.length) {
      await this.rolePermissions.insert(
        valid.map((permissionKey) => ({ roleId, permissionKey })),
      );
    }
  }

  /** Refuse an edit that would leave no role granting users.manage / roles.manage. */
  private async assertManagerCoverage(
    roleId: number,
    nextKeys: string[],
  ): Promise<void> {
    const next = new Set(nextKeys);
    for (const managerKey of MANAGER_KEYS) {
      if (next.has(managerKey)) continue;
      const others = await this.rolePermissions.find({
        where: { permissionKey: managerKey },
      });
      const stillCovered = others.some((g) => g.roleId !== roleId);
      if (!stillCovered) {
        throw new BadRequestException(
          `Phải còn ít nhất một vai trò giữ quyền "${managerKey}".`,
        );
      }
    }
  }

  private async oneOrFail(id: number): Promise<RoleDto> {
    const all = await this.list();
    const found = all.find((r) => r.id === id);
    if (!found) throw new NotFoundException('Không tìm thấy vai trò.');
    return found;
  }
}

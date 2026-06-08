import {
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './entities/user.entity';
import { RoleEntity, type RoleName } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import {
  type AccountUserDto,
  type AdminUserDto,
  type FeRole,
  roleToDb,
  roleToFe,
  toAccountUser,
  toAdminUser,
} from './user.mapper';

const BCRYPT_ROUNDS = 10;

export interface CreateUserData {
  name: string;
  username: string;
  email: string;
  phone?: string;
  shift?: string;
  role: FeRole;
  sendInvite?: boolean;
  password?: string;
}

export interface ProfilePatch {
  name?: string;
  email?: string;
  phone?: string;
  shift?: string;
  photo?: string | null;
}

export interface AdminListParams {
  search?: string;
  role?: FeRole | 'all';
  status?: AdminUserDto['status'] | 'all';
}

@Injectable()
export class UsersService implements OnModuleInit {
  private roleIdByName = new Map<RoleName, number>();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(RoleEntity) private readonly roles: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity) private readonly userRoles: Repository<UserRoleEntity>,
    @InjectRepository(UserSessionEntity) private readonly sessions: Repository<UserSessionEntity>,
    @InjectRepository(UserPreferenceEntity) private readonly prefs: Repository<UserPreferenceEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.loadRoles();
    } catch {
      // DB may not be ready at boot; roles are loaded lazily on first use.
    }
  }

  private async loadRoles(): Promise<void> {
    const rows = await this.roles.find();
    this.roleIdByName = new Map(rows.map((r) => [r.name, r.id]));
  }

  private async roleId(name: RoleName): Promise<number> {
    if (!this.roleIdByName.has(name)) await this.loadRoles();
    const id = this.roleIdByName.get(name);
    if (id == null) throw new NotFoundException(`Role ${name} not found`);
    return id;
  }

  /** First (and only) role of a user, defaulting to operator. */
  feRoleOf(user: UserEntity): FeRole {
    const name = user.userRoles?.[0]?.role?.name;
    return name ? roleToFe(name) : 'operator';
  }

  private withRoles() {
    return { relations: { userRoles: { role: true } } } as const;
  }

  findByUsername(username: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { username }, ...this.withRoles() });
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { email } });
  }

  async findByIdOrFail(id: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { id }, ...this.withRoles() });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async accountOf(id: string): Promise<AccountUserDto> {
    const user = await this.findByIdOrFail(id);
    return toAccountUser(user, this.feRoleOf(user));
  }

  // ── Admin listing ─────────────────────────────────────────────────────────
  async listAdmin(params: AdminListParams = {}): Promise<AdminUserDto[]> {
    const all = await this.users.find({ ...this.withRoles(), order: { createdAt: 'DESC' } });
    const onlineIds = await this.onlineUserIds();
    const q = params.search?.trim().toLowerCase();

    return all
      .map((u) => toAdminUser(u, this.feRoleOf(u), onlineIds.has(u.id)))
      .filter((u) => {
        if (params.role && params.role !== 'all' && u.role !== params.role) return false;
        if (params.status && params.status !== 'all' && u.status !== params.status) return false;
        if (q && !`${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q)) return false;
        return true;
      });
  }

  async adminUserOf(id: string): Promise<AdminUserDto> {
    const user = await this.findByIdOrFail(id);
    const onlineIds = await this.onlineUserIds();
    return toAdminUser(user, this.feRoleOf(user), onlineIds.has(user.id));
  }

  private async onlineUserIds(): Promise<Set<string>> {
    const rows = await this.sessions.find({
      where: { logoutAt: IsNull() },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  // ── Mutations ───────────────────────────────────────────────────────────────
  async createUser(data: CreateUserData, assignedBy?: string): Promise<UserEntity> {
    const tempPassword = data.password ?? this.randomToken(12);
    const user = this.users.create({
      username: data.username,
      email: data.email,
      fullName: data.name,
      phone: data.phone ?? null,
      shift: data.shift ?? null,
      passwordHash: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
      isActive: !data.sendInvite,
      isInvited: !!data.sendInvite,
    });
    const saved = await this.users.save(user);
    await this.assignRole(saved.id, data.role, assignedBy);
    return this.findByIdOrFail(saved.id);
  }

  async updateProfile(id: string, patch: ProfilePatch): Promise<UserEntity> {
    const user = await this.findByIdOrFail(id);
    if (patch.name !== undefined) user.fullName = patch.name;
    if (patch.email !== undefined) user.email = patch.email;
    if (patch.phone !== undefined) user.phone = patch.phone;
    if (patch.shift !== undefined) user.shift = patch.shift;
    if (patch.photo !== undefined) user.avatarUrl = patch.photo;
    await this.users.save(user);
    return this.findByIdOrFail(id);
  }

  async updateAdmin(
    id: string,
    patch: ProfilePatch & { role?: FeRole },
    assignedBy?: string,
  ): Promise<UserEntity> {
    await this.updateProfile(id, patch);
    if (patch.role) await this.setRole(id, patch.role, assignedBy);
    return this.findByIdOrFail(id);
  }

  /** Enforce exactly one role per user. */
  async setRole(id: string, role: FeRole, assignedBy?: string): Promise<void> {
    await this.userRoles.delete({ userId: id });
    await this.assignRole(id, role, assignedBy);
  }

  private async assignRole(userId: string, role: FeRole, assignedBy?: string): Promise<void> {
    const roleId = await this.roleId(roleToDb(role));
    await this.userRoles.save(
      this.userRoles.create({ userId, roleId, assignedBy: assignedBy ?? null }),
    );
  }

  async setLock(id: string, locking: boolean, reason?: string): Promise<UserEntity> {
    const user = await this.findByIdOrFail(id);
    user.isLocked = locking;
    user.lockReason = locking ? (reason ?? user.lockReason ?? null) : null;
    if (!locking && !user.isInvited) user.isActive = true;
    await this.users.save(user);
    return this.findByIdOrFail(id);
  }

  async remove(id: string): Promise<void> {
    const res = await this.users.delete(id);
    if (!res.affected) throw new NotFoundException('User not found');
  }

  async setPassword(id: string, plain: string): Promise<void> {
    const hash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
    await this.users.update(id, { passwordHash: hash });
  }

  verifyPassword(user: UserEntity, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, user.passwordHash);
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.users.update(id, { lastLoginAt: new Date(), isInvited: false });
  }

  // ── Preferences ─────────────────────────────────────────────────────────────
  async getPreferences(userId: string): Promise<UserPreferenceEntity> {
    let pref = await this.prefs.findOne({ where: { userId } });
    if (!pref) {
      pref = this.prefs.create({ userId });
      await this.prefs.save(pref);
    }
    return pref;
  }

  async updatePreferences(
    userId: string,
    patch: Partial<Pick<UserPreferenceEntity, 'language' | 'notificationsEnabled' | 'soundEnabled'>>,
  ): Promise<UserPreferenceEntity> {
    const pref = await this.getPreferences(userId);
    Object.assign(pref, patch, { updatedAt: new Date() });
    return this.prefs.save(pref);
  }

  randomToken(len = 32): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UsersService, type AdminListParams } from '../users/users.service';
import { TokenService } from '../auth/token.service';
import type { AdminUserDto } from '../users/user.mapper';
import type {
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  list(params: AdminListParams): Promise<AdminUserDto[]> {
    return this.users.listAdmin(params);
  }

  async create(dto: CreateAdminUserDto, actorId: string): Promise<AdminUserDto> {
    if (await this.users.findByUsername(dto.username)) {
      throw new ConflictException('Tên đăng nhập đã tồn tại.');
    }
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('Email đã được sử dụng.');
    }
    const created = await this.users.createUser(dto, actorId);
    return this.users.adminUserOf(created.id);
  }

  async update(id: string, dto: UpdateAdminUserDto, actorId: string): Promise<AdminUserDto> {
    await this.users.updateAdmin(id, dto, actorId);
    return this.users.adminUserOf(id);
  }

  async remove(id: string): Promise<void> {
    await this.users.remove(id);
  }

  async setRole(id: string, role: 'admin' | 'operator', actorId: string): Promise<AdminUserDto> {
    await this.users.setRole(id, role, actorId);
    return this.users.adminUserOf(id);
  }

  async lock(id: string, reason: string | undefined): Promise<AdminUserDto> {
    await this.users.setLock(id, true, reason);
    await this.tokens.revokeAllRefreshTokens(id);
    await this.tokens.endAllSessions(id);
    return this.users.adminUserOf(id);
  }

  async unlock(id: string): Promise<AdminUserDto> {
    await this.users.setLock(id, false);
    return this.users.adminUserOf(id);
  }

  /** Admin-initiated reset: issue a reset link (logged in dev) for the user. */
  async resetPassword(id: string): Promise<void> {
    const user = await this.users.findByIdOrFail(id);
    const raw = await this.tokens.createResetToken(user.id);
    this.logger.log(`Admin reset link for ${user.username}: /reset-password?token=${raw}`);
  }
}

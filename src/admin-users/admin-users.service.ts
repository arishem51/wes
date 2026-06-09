import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { UsersService, type AdminListParams } from '../users/users.service';
import { TokenService } from '../auth/token.service';
import { MailService } from '../mail/mail.service';
import type { AdminUserDto } from '../users/user.mapper';
import type {
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
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
    if (dto.sendInvite) {
      const raw = await this.tokens.createResetToken(created.id);
      await this.mail.sendPasswordReset({
        to: created.email,
        name: created.fullName,
        link: this.mail.passwordResetUrl(raw),
        subject: 'Activate your WES Console account',
        intro: 'An administrator created a WES Console account for you. Use this link to set your password and activate access.',
      });
    }
    return this.users.adminUserOf(created.id);
  }

  async update(id: string, dto: UpdateAdminUserDto, actorId: string): Promise<AdminUserDto> {
    await this.users.updateAdmin(id, dto, actorId);
    return this.users.adminUserOf(id);
  }

  async remove(id: string): Promise<AdminUserDto> {
    await this.users.remove(id);
    await this.tokens.revokeAllRefreshTokens(id);
    await this.tokens.endAllSessions(id);
    return this.users.adminUserOf(id);
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

  async activate(id: string): Promise<AdminUserDto> {
    await this.users.activate(id);
    return this.users.adminUserOf(id);
  }

  /** Admin-initiated reset: send a reset link to the user's email. */
  async resetPassword(id: string): Promise<void> {
    const user = await this.users.findByIdOrFail(id);
    if (!user.isActive && !user.isInvited) {
      throw new BadRequestException('Tai khoan dang ngung hoat dong.');
    }
    const raw = await this.tokens.createResetToken(user.id);
    await this.mail.sendPasswordReset({
      to: user.email,
      name: user.fullName,
      link: this.mail.passwordResetUrl(raw),
    });
  }
}

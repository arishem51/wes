import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { TokenService } from '../auth/token.service';
import type { AccountUserDto } from '../users/user.mapper';
import type { ChangePasswordDto, UpdatePreferencesDto, UpdateProfileDto } from './dto/account.dto';

@Injectable()
export class AccountService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  // UC-83
  getMe(userId: string): Promise<AccountUserDto> {
    return this.users.accountOf(userId);
  }

  // UC-84
  async updateMe(userId: string, dto: UpdateProfileDto): Promise<AccountUserDto> {
    await this.users.updateProfile(userId, dto);
    return this.users.accountOf(userId);
  }

  // UC-85
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findByIdOrFail(userId);
    const ok = await this.users.verifyPassword(user, dto.currentPassword);
    if (!ok) throw new BadRequestException('Mật khẩu hiện tại không đúng.');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại.');
    }
    await this.users.setPassword(userId, dto.newPassword);
  }

  async revokeOtherSessions(userId: string): Promise<void> {
    await this.tokens.endOtherSessions(userId);
  }

  async getPreferences(userId: string) {
    const p = await this.users.getPreferences(userId);
    return {
      language: p.language,
      notificationsEnabled: p.notificationsEnabled,
      soundEnabled: p.soundEnabled,
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const p = await this.users.updatePreferences(userId, dto);
    return {
      language: p.language,
      notificationsEnabled: p.notificationsEnabled,
      soundEnabled: p.soundEnabled,
    };
  }
}

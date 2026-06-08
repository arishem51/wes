import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { toAccountUser, type AccountUserDto } from '../users/user.mapper';
import { UserEntity } from '../users/entities/user.entity';

export interface LoginResult {
  token: string;
  refreshToken: string;
  user: AccountUserDto;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtl: string;

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessTtl = config.get<string>('JWT_ACCESS_TTL', '15m');
  }

  private signAccess(user: UserEntity): string {
    const role = this.users.feRoleOf(user);
    return this.jwt.sign(
      { sub: user.id, username: user.username, roles: [role] },
      { expiresIn: this.accessTtl },
    );
  }

  // UC-81
  async login(username: string, password: string, ip: string | null, ua: string | null): Promise<LoginResult> {
    const user = await this.users.findByUsername(username);
    if (!user) throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng.');
    if (user.isLocked) throw new UnauthorizedException('Tài khoản đã bị khóa.');
    const ok = await this.users.verifyPassword(user, password);
    if (!ok) throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng.');

    await this.users.touchLastLogin(user.id);
    await this.tokens.startSession(user.id, ip, ua);

    return {
      token: this.signAccess(user),
      refreshToken: await this.tokens.issueRefreshToken(user.id),
      user: toAccountUser(user, this.users.feRoleOf(user)),
    };
  }

  // UC-82
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefreshToken(refreshToken);
    await this.tokens.endAllSessions(userId);
  }

  async refresh(refreshToken?: string): Promise<LoginResult> {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const rotated = await this.tokens.rotateRefreshToken(refreshToken);
    if (!rotated) throw new UnauthorizedException('Refresh token không hợp lệ.');
    const user = await this.users.findByIdOrFail(rotated.userId);
    return {
      token: this.signAccess(user),
      refreshToken: rotated.token,
      user: toAccountUser(user, this.users.feRoleOf(user)),
    };
  }

  // UC-86 — always succeed silently to avoid account enumeration.
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;
    const raw = await this.tokens.createResetToken(user.id);
    // Dev: no SMTP — log the link so it can be used manually.
    this.logger.log(`Password reset link for ${email}: /reset-password?token=${raw}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consumeResetToken(token);
    if (!userId) throw new BadRequestException('Token không hợp lệ hoặc đã hết hạn.');
    await this.users.setPassword(userId, newPassword);
    await this.tokens.revokeAllRefreshTokens(userId);
  }
}

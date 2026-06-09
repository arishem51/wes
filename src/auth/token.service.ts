import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshTokenEntity } from '../users/entities/refresh-token.entity';
import { PasswordResetTokenEntity } from '../users/entities/password-reset-token.entity';
import { UserSessionEntity } from '../users/entities/user-session.entity';

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

@Injectable()
export class TokenService {
  private readonly refreshTtlMs: number;
  private readonly resetTtlMs: number;

  constructor(
    config: ConfigService,
    @InjectRepository(RefreshTokenEntity) private readonly refreshTokens: Repository<RefreshTokenEntity>,
    @InjectRepository(PasswordResetTokenEntity) private readonly resetTokens: Repository<PasswordResetTokenEntity>,
    @InjectRepository(UserSessionEntity) private readonly sessions: Repository<UserSessionEntity>,
  ) {
    this.refreshTtlMs = Number(config.get('REFRESH_TTL_DAYS', '7')) * 86400_000;
    this.resetTtlMs = Number(config.get('RESET_TTL_MINUTES', '30')) * 60_000;
  }

  // ── Refresh tokens ──────────────────────────────────────────────────────────
  async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(40).toString('hex');
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      }),
    );
    return raw;
  }

  /** Validate + rotate; returns the userId if valid, else null. */
  async rotateRefreshToken(raw: string): Promise<{ userId: string; token: string } | null> {
    const row = await this.refreshTokens.findOne({ where: { tokenHash: sha256(raw), isRevoked: false } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    row.isRevoked = true;
    await this.refreshTokens.save(row);
    const token = await this.issueRefreshToken(row.userId);
    return { userId: row.userId, token };
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    if (!raw) return;
    await this.refreshTokens.update({ tokenHash: sha256(raw) }, { isRevoked: true });
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, isRevoked: false }, { isRevoked: true });
  }

  // ── Password reset tokens ─────────────────────────────────────────────────────
  async createResetToken(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.resetTokens.save(
      this.resetTokens.create({
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.resetTtlMs),
      }),
    );
    return raw;
  }

  /** Returns userId if the reset token is valid + unused, marking it used. */
  async consumeResetToken(raw: string): Promise<string | null> {
    const row = await this.resetTokens.findOne({ where: { tokenHash: sha256(raw), usedAt: IsNull() } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    row.usedAt = new Date();
    await this.resetTokens.save(row);
    return row.userId;
  }

  // ── Sessions ────────────────────────────────────────────────────────────────
  async startSession(userId: string, ip: string | null, userAgent: string | null): Promise<void> {
    await this.sessions.save(this.sessions.create({ userId, ipAddress: ip, userAgent, loginAt: new Date() }));
  }

  async endAllSessions(userId: string): Promise<void> {
    await this.sessions.update({ userId, logoutAt: IsNull() }, { logoutAt: new Date() });
  }

  /** End every active session except the most recent one (keep current device). */
  async endOtherSessions(userId: string): Promise<void> {
    const active = await this.sessions.find({
      where: { userId, logoutAt: IsNull() },
      order: { loginAt: 'DESC' },
    });
    const others = active.slice(1);
    await Promise.all(
      others.map((s) => this.sessions.update(s.id, { logoutAt: new Date() })),
    );
  }

  /** Housekeeping helper (not scheduled): drop expired refresh tokens. */
  async purgeExpired(): Promise<void> {
    await this.refreshTokens.delete({ expiresAt: LessThan(new Date()) });
  }
}

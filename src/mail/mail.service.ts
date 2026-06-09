import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

interface PasswordResetMail {
  to: string;
  name?: string | null;
  link: string;
  subject?: string;
  intro?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly appUrl: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST')?.trim();
    const port = Number(config.get<string>('SMTP_PORT', '587'));
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASS');
    const secureEnv = config.get<string>('SMTP_SECURE')?.toLowerCase();
    const secure = secureEnv ? secureEnv === 'true' : port === 465;

    this.appUrl = (config.get<string>('APP_URL') ?? config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173').replace(/\/+$/, '');
    this.from = config.get<string>('MAIL_FROM') ?? (user ? `WES Console <${user}>` : 'WES Console <no-reply@localhost>');
    this.transporter = host
      ? createTransport({
          host,
          port,
          secure,
          auth: user && pass ? { user, pass } : undefined,
        })
      : null;
  }

  passwordResetUrl(token: string): string {
    const url = new URL('/reset-password', `${this.appUrl}/`);
    url.searchParams.set('token', token);
    return url.toString();
  }

  async sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP is not configured; reset link for ${mail.to}: ${mail.link}`);
      return;
    }

    const safeName = escapeHtml(mail.name?.trim() || 'WES user');
    const safeLink = escapeHtml(mail.link);
    const intro = mail.intro ?? 'A password reset was requested for your WES Console account.';
    const subject = mail.subject ?? 'WES Console password reset';

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: mail.to,
        subject,
        text: [
          `Hello ${mail.name?.trim() || 'WES user'},`,
          '',
          intro,
          'Open this link to set a new password:',
          mail.link,
          '',
          'This link expires soon. If you did not request this, you can ignore this email.',
        ].join('\n'),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#14213d">
            <p>Hello ${safeName},</p>
            <p>${escapeHtml(intro)}</p>
            <p>
              <a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#3568ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">
                Reset password
              </a>
            </p>
            <p>If the button does not work, copy this link:</p>
            <p style="word-break:break-all;color:#475569">${safeLink}</p>
            <p style="color:#64748b;font-size:13px">This link expires soon. If you did not request this, you can ignore this email.</p>
          </div>
        `,
      });
      this.logger.log(`Password reset email sent to ${mail.to}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send password reset email to ${mail.to}: ${detail}`);
      throw new ServiceUnavailableException('Could not send password reset email.');
    }
  }
}

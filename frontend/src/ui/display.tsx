import type { ReactNode } from 'react';
import { Icon } from '@/lib/icons';
import { hueFor, initials } from '@/lib/format';
import type { TFunc } from '@/i18n';
import type { Role, User, UserStatus } from '@/types/user';

export function Avatar({
  user,
  size = 38,
  showDot,
}: {
  user: Pick<User, 'id' | 'name' | 'online'>;
  size?: number;
  showDot?: boolean;
}) {
  const hue = hueFor(user.id);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `oklch(0.93 0.04 ${hue})`,
          color: `oklch(0.42 0.12 ${hue})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          fontSize: size * 0.36,
          letterSpacing: '-.02em',
          border: `1px solid oklch(0.88 0.05 ${hue})`,
        }}
      >
        {initials(user.name)}
      </div>
      {showDot && user.online && (
        <span
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: size * 0.28,
            height: size * 0.28,
            background: 'var(--success)',
            borderRadius: '50%',
            border: '2px solid var(--surface)',
          }}
        />
      )}
    </div>
  );
}

export const STATUS_STYLE: Record<UserStatus, { fg: string; bg: string; dot: string }> = {
  active: { fg: 'var(--success-fg)', bg: 'var(--success-tint)', dot: 'var(--success)' },
  locked: { fg: 'var(--danger-fg)', bg: 'var(--danger-tint)', dot: 'var(--danger)' },
  invited: { fg: 'var(--accent-fg)', bg: 'var(--accent-tint)', dot: 'var(--accent)' },
  inactive: { fg: 'var(--text-muted)', bg: 'var(--subtle)', dot: 'var(--text-faint)' },
};

export function StatusBadge({ status, t }: { status: UserStatus; t: TFunc }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.inactive;
  const label = {
    active: t('st_active'),
    locked: t('st_locked'),
    invited: t('st_invited'),
    inactive: t('st_inactive'),
  }[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px 3px 8px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        color: s.fg,
        background: s.bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

export function RolePill({ role, t }: { role: Role; t: TFunc }) {
  const isAdmin = role === 'admin';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 6,
        fontSize: 12.5,
        fontWeight: 500,
        color: isAdmin ? 'var(--role-admin-fg)' : 'var(--role-op-fg)',
        background: isAdmin ? 'var(--role-admin-bg)' : 'var(--role-op-bg)',
        border: `1px solid ${isAdmin ? 'var(--role-admin-bd)' : 'var(--role-op-bd)'}`,
      }}
    >
      <Icon name={isAdmin ? 'shield' : 'user'} size={13} />
      {isAdmin ? t('role_admin') : t('role_operator')}
    </span>
  );
}

const ACCESS_TONE_STYLE: Record<string, { fg: string; bd: string }> = {
  green: { fg: 'oklch(0.50 0.13 156)', bd: 'oklch(0.83 0.08 156)' },
  blue: { fg: 'oklch(0.50 0.14 250)', bd: 'oklch(0.83 0.08 250)' },
  violet: { fg: 'oklch(0.50 0.16 292)', bd: 'oklch(0.84 0.09 292)' },
  gray: { fg: 'var(--text-muted)', bd: 'var(--border-strong)' },
};

export function AccessPill({ tone, children, dot }: { tone: string; children: ReactNode; dot?: boolean }) {
  const s = ACCESS_TONE_STYLE[tone] || ACCESS_TONE_STYLE.gray;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        color: s.fg,
        border: `1px solid ${s.bd}`,
        background: 'var(--surface)',
        whiteSpace: 'nowrap',
      }}
    >
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.fg }} />}
      {children}
    </span>
  );
}

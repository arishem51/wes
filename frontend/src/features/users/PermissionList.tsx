import { Icon } from '@/lib/icons';
import { PERMISSIONS } from '@/data/mock';
import type { Lang, TFunc } from '@/i18n';
import type { PermGroup, PermLevel, Role } from '@/types/user';

const PERM_GROUPS: PermGroup[] = [
  'pg_fleet',
  'pg_map',
  'pg_requests',
  'pg_dispatch',
  'pg_dashboard',
  'pg_users',
  'pg_audit',
];

const PERM_LEVEL: Record<PermLevel, { vi: string; en: string; fg: string; bg: string; icon: string }> = {
  full: { vi: 'Toàn quyền', en: 'Full', fg: 'var(--success-fg)', bg: 'var(--success-tint)', icon: 'check' },
  view: { vi: 'Chỉ xem', en: 'View', fg: 'var(--accent-fg)', bg: 'var(--accent-tint)', icon: 'eye' },
  none: { vi: 'Không', en: 'None', fg: 'var(--text-faint)', bg: 'var(--subtle)', icon: 'close' },
};

export function PermissionList({ role, t, lang }: { role: Role; t: TFunc; lang: Lang }) {
  const perms = PERMISSIONS[role];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {PERM_GROUPS.map((g, i) => {
        const lvl = perms[g] || 'none';
        const meta = PERM_LEVEL[lvl];
        return (
          <div
            key={g}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 13px',
              background: 'var(--surface)',
              borderTop: i ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{t(g)}</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 9px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                color: meta.fg,
                background: meta.bg,
              }}
            >
              <Icon name={meta.icon} size={13} />
              {meta[lang]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

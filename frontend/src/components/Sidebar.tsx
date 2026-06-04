import { Icon } from '@/lib/icons';
import type { TFunc } from '@/i18n';

const NAV = [
  {
    section: 'nav_section_ops',
    items: [
      { id: 'dashboard', icon: 'gauge', label: 'nav_dashboard' },
      { id: 'requests', icon: 'truck', label: 'nav_requests' },
      { id: 'fleet', icon: 'list', label: 'nav_fleet' },
    ],
  },
  {
    section: 'nav_org',
    items: [
      { id: 'users', icon: 'users', label: 'nav_users' },
      { id: 'map', icon: 'map', label: 'nav_map' },
      { id: 'dispatch', icon: 'grid', label: 'nav_dispatch' },
      { id: 'audit', icon: 'bell', label: 'nav_audit' },
    ],
  },
];
const NAV_BOTTOM = [
  { id: 'settings', icon: 'gauge', label: 'nav_settings' },
  { id: 'docs', icon: 'list', label: 'nav_docs' },
];

function NavItem({
  icon,
  label,
  active,
  badge,
}: {
  icon: string;
  label: string;
  active?: boolean;
  badge?: number | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '9px 11px',
        borderRadius: 8,
        marginBottom: 2,
        cursor: active ? 'default' : 'pointer',
        fontSize: 14,
        fontWeight: 500,
        color: active ? 'var(--text)' : 'var(--text-muted)',
        background: active ? 'var(--subtle-strong)' : 'transparent',
        transition: 'background .12s',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--subtle)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Icon name={icon} size={18} style={{ color: active ? 'var(--text)' : 'var(--text-faint)' }} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--text-muted)',
            background: 'var(--subtle-strong)',
            borderRadius: 999,
            padding: '1px 7px',
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export function Sidebar({ t }: { t: TFunc }) {
  return (
    <aside
      style={{
        width: 252,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '20px 18px 18px' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--btn-dark)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            flexShrink: 0,
          }}
        >
          <Icon name="grid" size={18} />
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.01em', flex: 1 }}>
          {t('app_name')}
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>v1.0</span>
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 12px' }}>
        {NAV.map((grp) => (
          <div key={grp.section} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                padding: '0 11px 8px',
              }}
            >
              {t(grp.section)}
            </div>
            {grp.items.map((it) => (
              <NavItem
                key={it.id}
                icon={it.icon}
                label={t(it.label)}
                active={it.id === 'users'}
                badge={it.id === 'audit' ? 4 : null}
              />
            ))}
          </div>
        ))}
      </nav>
      <div style={{ padding: '8px 12px 14px' }}>
        {NAV_BOTTOM.map((it) => (
          <NavItem key={it.id} icon={it.icon} label={t(it.label)} />
        ))}
      </div>
    </aside>
  );
}

import { Icon } from '@/lib/icons';
import { IconButton, Segmented } from '@/ui/controls';
import { Avatar } from '@/ui/display';
import type { Lang, TFunc } from '@/i18n';

const ADMIN_USER = { id: 'u-1001', name: 'Trần Minh Quân', online: true };

export function Topbar({
  t,
  lang,
  setLang,
}: {
  t: TFunc;
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 28px',
        height: 60,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          fontSize: 13.5,
          color: 'var(--text-muted)',
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: 'linear-gradient(135deg, var(--accent), oklch(0.6 0.18 300))',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <Icon name="chevright" size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <span style={{ whiteSpace: 'nowrap' }}>{t('app_sub')}</span>
        <Icon name="chevright" size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <span style={{ color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t('nav_users')}
        </span>
      </div>
      <Segmented
        value={lang}
        onChange={(v) => setLang(v as Lang)}
        options={[
          { value: 'vi', label: 'VI' },
          { value: 'en', label: 'EN' },
        ]}
      />
      <IconButton name="bell" label="Notifications" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 6 }}>
        <Avatar user={ADMIN_USER} size={34} showDot />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{ADMIN_USER.name}</span>
      </div>
    </header>
  );
}

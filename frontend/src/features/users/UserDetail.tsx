import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '@/lib/icons';
import { Button, IconButton } from '@/ui/controls';
import { Avatar, StatusBadge, RolePill } from '@/ui/display';
import { relTime, fmtDate } from '@/lib/format';
import { activityFor } from '@/data/mock';
import { PermissionList } from './PermissionList';
import type { UserAction } from './views';
import type { Lang, TFunc } from '@/i18n';
import type { User } from '@/types/user';

const ACT_ICON: Record<string, string> = {
  login: 'user',
  logout: 'user',
  request: 'truck',
  config: 'gauge',
  user: 'users',
  fleet: 'truck',
};

export function UserDetail({
  user,
  onClose,
  onAction,
  t,
  lang,
}: {
  user: User | null;
  onClose: () => void;
  onAction: (type: UserAction, user: User) => void;
  t: TFunc;
  lang: Lang;
}) {
  const [tab, setTab] = useState<'overview' | 'perms' | 'activity'>('overview');
  if (!user) return null;
  const activity = activityFor(user.role);
  const locked = user.status === 'locked';

  const InfoRow = ({ icon, label, value, mono }: { icon: string; label: string; value: ReactNode; mono?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
      <Icon name={icon} size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--text-muted)', width: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13.5, color: 'var(--text)', fontFamily: mono ? 'var(--mono)' : 'inherit', textAlign: 'right', marginLeft: 'auto' }}>
        {value}
      </span>
    </div>
  );

  const tabs = [
    { id: 'overview' as const, label: t('detail_overview') },
    { id: 'perms' as const, label: t('detail_perms') },
    { id: 'activity' as const, label: t('detail_activity') },
  ];

  return (
    <>
      <div style={{ padding: '18px 22px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {t('detail_account')}
          </span>
          <IconButton name="close" label="Close" onClick={onClose} />
        </div>
        <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
          <Avatar user={user} size={58} showDot />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--text)', letterSpacing: '-.01em' }}>{user.name}</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 1 }}>@{user.username}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0 4px', flexWrap: 'wrap' }}>
          <StatusBadge status={user.status} t={t} />
          <RolePill role={user.role} t={t} />
          {user.online && (
            <span style={{ fontSize: 12.5, color: 'var(--success-fg)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              {t('online')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '14px 0 16px', flexWrap: 'wrap' }}>
          <Button size="sm" variant="default" icon="edit" onClick={() => onAction('edit', user)}>
            {t('act_edit')}
          </Button>
          <Button size="sm" variant="default" icon="shield" onClick={() => onAction('roles', user)}>
            {t('act_roles')}
          </Button>
          <Button size="sm" variant="default" icon="key" onClick={() => onAction('reset', user)}>
            {t('act_reset')}
          </Button>
          {locked ? (
            <Button size="sm" variant="default" icon="unlock" onClick={() => onAction('unlock', user)}>
              {t('act_unlock')}
            </Button>
          ) : (
            <Button size="sm" variant="default" icon="lock" onClick={() => onAction('lock', user)}>
              {t('act_lock')}
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13.5,
                fontWeight: 500,
                padding: '9px 12px 12px',
                color: tab === tb.id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: `2px solid ${tab === tb.id ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 24px' }}>
        {tab === 'overview' && (
          <div>
            {locked && user.lockReason && (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '11px 13px',
                  margin: '14px 0 4px',
                  borderRadius: 'var(--radius)',
                  background: 'var(--danger-tint)',
                  border: '1px solid var(--danger-border)',
                }}
              >
                <Icon name="lock" size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: 'var(--danger-fg)', lineHeight: 1.5 }}>{user.lockReason}</div>
              </div>
            )}
            <InfoRow icon="mail" label={t('field_email')} value={user.email} />
            <InfoRow icon="phone" label={t('field_phone')} value={user.phone} mono />
            <InfoRow icon="clock" label={t('field_shift')} value={user.shift} />
            <InfoRow icon="shield" label={t('field_mfa')} value={user.mfa ? t('mfa_on') : t('mfa_off')} />
            <InfoRow icon="user" label={t('field_lastlogin')} value={relTime(user.lastLogin, t)} />
            <InfoRow icon="clock" label={t('field_created')} value={fmtDate(user.created, lang)} />

            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
                {t('danger_zone')}
              </div>
              <div
                style={{
                  border: '1px solid var(--danger-border)',
                  borderRadius: 'var(--radius)',
                  padding: '13px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  background: 'var(--danger-soft)',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>{t('delete_title')}</span>
                <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => onAction('delete', user)}>
                  {t('act_delete')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === 'perms' && (
          <div style={{ paddingTop: 16 }}>
            <div
              style={{
                display: 'flex',
                gap: 11,
                padding: '13px 14px',
                marginBottom: 16,
                borderRadius: 'var(--radius)',
                background: user.role === 'admin' ? 'var(--role-admin-bg)' : 'var(--role-op-bg)',
                border: `1px solid ${user.role === 'admin' ? 'var(--role-admin-bd)' : 'var(--role-op-bd)'}`,
              }}
            >
              <Icon
                name={user.role === 'admin' ? 'shield' : 'user'}
                size={18}
                style={{ color: user.role === 'admin' ? 'var(--role-admin-fg)' : 'var(--role-op-fg)', flexShrink: 0, marginTop: 1 }}
              />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                  {user.role === 'admin' ? t('role_admin') : t('role_operator')}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                  {user.role === 'admin' ? t('role_admin_desc') : t('role_operator_desc')}
                </div>
              </div>
            </div>
            <PermissionList role={user.role} t={t} lang={lang} />
            <Button variant="default" full icon="shield" onClick={() => onAction('roles', user)} style={{ marginTop: 14 }}>
              {t('act_roles')}
            </Button>
          </div>
        )}

        {tab === 'activity' && (
          <div style={{ paddingTop: 18 }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 13, paddingBottom: i === activity.length - 1 ? 0 : 18, position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: 'var(--subtle)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                      zIndex: 1,
                    }}
                  >
                    <Icon name={ACT_ICON[a.action] || 'clock'} size={14} />
                  </span>
                  {i !== activity.length - 1 && <span style={{ width: 1.5, flex: 1, background: 'var(--border)', marginTop: 2 }} />}
                </div>
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.45 }}>{a.text[lang]}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{relTime(a.at, t)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

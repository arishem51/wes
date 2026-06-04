import { Icon } from '@/lib/icons';
import { IconButton, Checkbox } from '@/ui/controls';
import { Menu } from '@/ui/overlay';
import { Avatar, StatusBadge, RolePill, AccessPill, STATUS_STYLE } from '@/ui/display';
import { relTime, fmtDate } from '@/lib/format';
import { accessFor, ACCESS_TONE } from '@/data/mock';
import type { Lang, TFunc } from '@/i18n';
import type { User } from '@/types/user';

export type UserAction =
  | 'view'
  | 'edit'
  | 'roles'
  | 'reset'
  | 'lock'
  | 'unlock'
  | 'delete'
  | 'create';

type ActionFn = (type: UserAction, user: User) => void;

function rowMenuItems(user: User, onAction: ActionFn, t: TFunc) {
  const locked = user.status === 'locked';
  return [
    { label: t('act_view'), icon: 'eye', onClick: () => onAction('view', user) },
    { label: t('act_edit'), icon: 'edit', onClick: () => onAction('edit', user) },
    { label: t('act_roles'), icon: 'shield', onClick: () => onAction('roles', user) },
    { label: t('act_reset'), icon: 'key', onClick: () => onAction('reset', user) },
    { divider: true },
    locked
      ? { label: t('act_unlock'), icon: 'unlock', onClick: () => onAction('unlock', user) }
      : { label: t('act_lock'), icon: 'lock', onClick: () => onAction('lock', user) },
    { label: t('act_delete'), icon: 'trash', danger: true, onClick: () => onAction('delete', user) },
  ];
}

function RowMenu({ user, onAction, t }: { user: User; onAction: ActionFn; t: TFunc }) {
  return <Menu align="right" trigger={<IconButton name="dots" label="Actions" />} items={rowMenuItems(user, onAction, t)} />;
}

function AccessCell({ user, t }: { user: User; t: TFunc }) {
  const tags = accessFor(user.role);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {user.status !== 'active' && (
        <span style={{ display: 'inline-flex' }}>
          <StatusBadge status={user.status} t={t} />
        </span>
      )}
      {tags.map((tg) => (
        <AccessPill key={tg} tone={ACCESS_TONE[tg]} dot={tg === 'admin'}>
          {t('acc_' + tg)}
        </AccessPill>
      ))}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  w,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  w?: number;
}) {
  return (
    <th style={{ textAlign: 'left', padding: '11px 16px', width: w, whiteSpace: 'nowrap' }}>
      <button
        onClick={onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          color: active ? 'var(--text)' : 'var(--text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          padding: 0,
        }}
      >
        {label}
        <Icon
          name="chevdown"
          size={13}
          style={{
            opacity: active ? 1 : 0.35,
            transform: active && dir === 'asc' ? 'rotate(180deg)' : 'none',
            transition: 'transform .15s',
          }}
        />
      </button>
    </th>
  );
}

interface ViewProps {
  users: User[];
  selected: Set<string>;
  toggle: (id: string) => void;
  onOpen: (u: User) => void;
  onAction: ActionFn;
  t: TFunc;
  lang: Lang;
}

interface TableViewProps extends ViewProps {
  toggleAll: () => void;
  allSel: boolean;
  someSel: boolean;
  density: 'compact' | 'regular';
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}

export function TableView({
  users,
  selected,
  toggle,
  toggleAll,
  allSel,
  someSel,
  onOpen,
  onAction,
  t,
  lang,
  density,
  sortKey,
  sortDir,
  onSort,
}: TableViewProps) {
  const pad = density === 'compact' ? '10px 16px' : '14px 16px';
  const Th = ({ children, w }: { children: React.ReactNode; w?: number }) => (
    <th
      style={{
        textAlign: 'left',
        padding: '11px 16px',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-faint)',
        textTransform: 'uppercase',
        letterSpacing: '.04em',
        width: w,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '11px 16px', width: 20 }}>
              <Checkbox checked={allSel} indeterminate={someSel} onChange={toggleAll} />
            </th>
            <Th>{t('col_user')}</Th>
            <Th>{t('col_access')}</Th>
            <SortHeader label={t('col_lastactive')} active={sortKey === 'lastActive'} dir={sortDir} onClick={() => onSort('lastActive')} w={150} />
            <SortHeader label={t('col_dateadded')} active={sortKey === 'created'} dir={sortDir} onClick={() => onSort('created')} w={130} />
            <th style={{ width: 52 }} />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const sel = selected.has(u.id);
            return (
              <tr
                key={u.id}
                onClick={() => onOpen(u)}
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: sel ? 'var(--accent-tint)' : 'transparent',
                  transition: 'background .1s',
                }}
                onMouseEnter={(e) => {
                  if (!sel) e.currentTarget.style.background = 'var(--subtle-soft)';
                }}
                onMouseLeave={(e) => {
                  if (!sel) e.currentTarget.style.background = 'transparent';
                }}
              >
                <td style={{ padding: pad }} onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={sel} onChange={() => toggle(u.id)} />
                </td>
                <td style={{ padding: pad }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar user={u} size={density === 'compact' ? 34 : 40} showDot />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{u.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{u.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: pad }}>
                  <AccessCell user={u} t={t} />
                </td>
                <td style={{ padding: pad, fontSize: 13.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{relTime(u.lastActive, t)}</td>
                <td style={{ padding: pad, fontSize: 13.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(u.created, lang)}</td>
                <td style={{ padding: pad, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <RowMenu user={u} onAction={onAction} t={t} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CardsView({ users, selected, toggle, onOpen, onAction, t }: ViewProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      {users.map((u) => {
        const sel = selected.has(u.id);
        return (
          <div
            key={u.id}
            onClick={() => onOpen(u)}
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              cursor: 'pointer',
              border: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
              boxShadow: sel ? '0 0 0 3px var(--accent-ring)' : 'var(--shadow-sm)',
              transition: 'box-shadow .14s, border-color .14s, transform .14s',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = sel ? '0 0 0 3px var(--accent-ring)' : 'var(--shadow-md)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = sel ? '0 0 0 3px var(--accent-ring)' : 'var(--shadow-sm)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div onClick={(e) => e.stopPropagation()}>
                <Avatar user={u} size={46} showDot />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>@{u.username}</div>
              </div>
              <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Checkbox checked={sel} onChange={() => toggle(u.id)} />
                <RowMenu user={u} onAction={onAction} t={t} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7, margin: '13px 0', flexWrap: 'wrap' }}>
              <RolePill role={u.role} t={t} />
              <StatusBadge status={u.status} t={t} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-muted)', paddingTop: 11, borderTop: '1px solid var(--border)' }}>
              <Icon name="mail" size={14} style={{ color: 'var(--text-faint)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-muted)', marginTop: 7 }}>
              <Icon name="clock" size={14} style={{ color: 'var(--text-faint)' }} />
              <span>{relTime(u.lastActive, t)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CompactView({ users, selected, toggle, onOpen, onAction, t }: ViewProps) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      {users.map((u, i) => {
        const sel = selected.has(u.id);
        return (
          <div
            key={u.id}
            onClick={() => onOpen(u)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 14px',
              cursor: 'pointer',
              borderTop: i ? '1px solid var(--border)' : 'none',
              background: sel ? 'var(--accent-tint)' : 'transparent',
              transition: 'background .1s',
            }}
            onMouseEnter={(e) => {
              if (!sel) e.currentTarget.style.background = 'var(--subtle-soft)';
            }}
            onMouseLeave={(e) => {
              if (!sel) e.currentTarget.style.background = 'transparent';
            }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={sel} onChange={() => toggle(u.id)} />
            </div>
            <Avatar user={u} size={28} showDot />
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', minWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)', minWidth: 120, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{u.username}</span>
            <RolePill role={u.role} t={t} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_STYLE[u.status].dot, flexShrink: 0 }} title={u.status} />
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', width: 100, textAlign: 'right', whiteSpace: 'nowrap' }}>{relTime(u.lastActive, t)}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <RowMenu user={u} onAction={onAction} t={t} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ t }: { t: TFunc }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '70px 20px',
        background: 'var(--surface)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'var(--subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-faint)',
          marginBottom: 14,
        }}
      >
        <Icon name="search" size={24} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{t('no_results')}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4 }}>{t('no_results_hint')}</div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/ui/icons';
import { Eyebrow, Button } from '@/ui/controls';
import { TextInput } from '@/ui/fields';
import { Avatar } from '@/ui/display';
import { useToast } from '@/ui/toast';
import { adminUsersApi } from '@/api/adminUsers';
import { toApiError } from '@/api/client';
import { relTime, fmtDate } from '@/lib/format';
import { PermissionList } from './Permissions';
import { UserFormModal, RolesModal, ResetModal, LockModal, ActivateModal, DeleteModal, type UserForm } from './modals';
import type { Lang, TFunc } from '@/i18n';
import type { AdminUser, AdminUserStatus, Role } from '@/types/adminUser';

type UserAction = 'view' | 'edit' | 'roles' | 'reset' | 'lock' | 'unlock' | 'activate' | 'delete';
type ModalState =
  | { type: 'form'; mode: 'create' | 'edit'; user: AdminUser | null }
  | { type: 'roles'; user: AdminUser }
  | { type: 'reset'; user: AdminUser }
  | { type: 'lock'; user: AdminUser; locking: boolean }
  | { type: 'activate'; user: AdminUser }
  | { type: 'delete'; user: AdminUser }
  | null;

function RolePill({ role, t }: { role: Role; t: TFunc }) {
  return (
    <span className={'role-pill ' + role}>
      <Icon name={role === 'admin' ? 'shield' : 'user'} size={13} />
      {role === 'admin' ? t('role_admin') : t('role_operator')}
    </span>
  );
}

function StatusBadge({ status, t }: { status: AdminUserStatus; t: TFunc }) {
  const label = { active: t('st_active'), locked: t('st_locked'), invited: t('st_invited'), inactive: t('st_inactive') }[status];
  return (
    <span className={'status-badge ' + status}>
      <span className="dot" />
      {label}
    </span>
  );
}

function RowMenu({ user, onAction, t }: { user: AdminUser; onAction: (a: UserAction, u: AdminUser) => void; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const locked = user.status === 'locked';
  const inactive = user.status === 'inactive';
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="um-rowbtn" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-label="Actions">
        <Icon name="dots" size={18} />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="menu-pop" style={{ minWidth: 196 }} onClick={(e) => e.stopPropagation()}>
            {([
              ['view', 'eye', t('act_view')],
              ['edit', 'edit', t('act_edit')],
              ['roles', 'shield', t('act_roles')],
              ['reset', 'key', t('act_reset')],
            ] as const).map(([a, ic, label]) => (
              <button key={a} className="menu-item" onClick={() => { setOpen(false); onAction(a, user); }}>
                <Icon name={ic} size={17} />
                {label}
              </button>
            ))}
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { setOpen(false); onAction(inactive ? 'activate' : locked ? 'unlock' : 'lock', user); }}>
              <Icon name={inactive ? 'check' : locked ? 'unlock' : 'lock'} size={17} />
              {inactive ? t('act_activate') : locked ? t('act_unlock') : t('act_lock')}
            </button>
            <button className="menu-item danger" onClick={() => { setOpen(false); onAction('delete', user); }}>
              <Icon name="trash" size={17} />
              {t('act_delete')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="um-filter">
      <select className="um-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevdown" size={16} />
    </div>
  );
}

function DetailDrawer({
  user,
  onClose,
  onAction,
  t,
  lang,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onAction: (a: UserAction, u: AdminUser) => void;
  t: TFunc;
  lang: Lang;
}) {
  const [tab, setTab] = useState<'overview' | 'perms'>('overview');
  useEffect(() => {
    if (user) setTab('overview');
  }, [user]);
  if (!user) return null;
  const locked = user.status === 'locked';
  const inactive = user.status === 'inactive';
  const Info = ({ icon, label, value, mono }: { icon: string; label: string; value: string; mono?: boolean }) => (
    <div className="um-inforow">
      <span className="um-inforow-ic"><Icon name={icon} size={16} /></span>
      <span className="um-inforow-l">{label}</span>
      <span className="um-inforow-v" style={{ fontFamily: mono ? 'var(--mono)' : 'inherit' }}>{value}</span>
    </div>
  );
  return (
    <div className="um-drawer-overlay" onMouseDown={onClose}>
      <div className="um-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="um-drawer-head">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{t('d_account')}</span>
            <button className="um-rowbtn" onClick={onClose}><Icon name="x" size={18} /></button>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <Avatar name={user.name} size={56} ring />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.01em' }}>{user.name}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>@{user.username}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0 6px', flexWrap: 'wrap' }}>
            <StatusBadge status={user.status} t={t} />
            <RolePill role={user.role} t={t} />
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '12px 0 14px', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" icon="edit" onClick={() => onAction('edit', user)}>{t('act_edit')}</Button>
            <Button variant="secondary" size="sm" icon="shield" onClick={() => onAction('roles', user)}>{t('act_roles')}</Button>
            <Button variant="secondary" size="sm" icon="key" onClick={() => onAction('reset', user)}>{t('act_reset')}</Button>
            <Button
              variant="secondary"
              size="sm"
              icon={inactive ? 'check' : locked ? 'unlock' : 'lock'}
              onClick={() => onAction(inactive ? 'activate' : locked ? 'unlock' : 'lock', user)}
            >
              {inactive ? t('act_activate') : locked ? t('act_unlock') : t('act_lock')}
            </Button>
          </div>
          <div className="um-drawer-tabs">
            <button className={'um-drawer-tab' + (tab === 'overview' ? ' active' : '')} onClick={() => setTab('overview')}>{t('d_overview')}</button>
            <button className={'um-drawer-tab' + (tab === 'perms' ? ' active' : '')} onClick={() => setTab('perms')}>{t('d_perms')}</button>
          </div>
        </div>
        <div className="um-drawer-body">
          {tab === 'overview' ? (
            <>
              {locked && user.lockReason && (
                <div style={{ display: 'flex', gap: 10, padding: '11px 13px', margin: '12px 0 4px', borderRadius: 12, background: 'rgba(214,69,58,.08)', border: '1px solid rgba(214,69,58,.25)' }}>
                  <Icon name="lock" size={16} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 12.5, color: 'var(--red)', lineHeight: 1.5 }}>{user.lockReason}</div>
                </div>
              )}
              <Info icon="mail" label={t('field_email')} value={user.email} mono />
              <Info icon="phone" label={t('field_phone')} value={user.phone} mono />
              <Info icon="clock" label={t('field_shift')} value={user.shift} />
              <Info icon="user" label={t('col_lastactive')} value={relTime(user.lastActive, t)} />
              <Info icon="clock" label={t('field_created')} value={fmtDate(user.created, lang)} />
              <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>{t('danger_zone')}</div>
                <div className="danger-box">
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{t('del_title')}</span>
                  <Button variant="secondary" size="sm" icon="trash" onClick={() => onAction('delete', user)} style={{ color: 'var(--red)', boxShadow: 'inset 0 0 0 1.5px rgba(214,69,58,.3)' }}>{t('act_delete')}</Button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ paddingTop: 14 }}>
              <div className={'role-info ' + user.role} style={{ marginBottom: 14 }}>
                <Icon name={user.role === 'admin' ? 'shield' : 'user'} size={18} style={{ color: user.role === 'admin' ? 'var(--accent-deep)' : '#1c7d6b', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{user.role === 'admin' ? t('role_admin') : t('role_operator')}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>{user.role === 'admin' ? t('role_admin_desc') : t('role_operator_desc')}</div>
                </div>
              </div>
              <PermissionList role={user.role} t={t} />
              <Button variant="secondary" full icon="shield" onClick={() => onAction('roles', user)} style={{ marginTop: 14 }}>{t('act_roles')}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function UsersAdmin({ t, lang }: { t: TFunc; lang: Lang }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [roleF, setRoleF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    adminUsersApi.list({}).then(setUsers).catch((e) => toast(toApiError(e)));
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (roleF === 'all' || u.role === roleF) &&
        (statusF === 'all' || u.status === statusF) &&
        (!q || u.name.toLowerCase().includes(q) || u.username.includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [users, search, roleF, statusF]);

  const upsert = (u: AdminUser) => setUsers((us) => (us.some((x) => x.id === u.id) ? us.map((x) => (x.id === u.id ? u : x)) : [u, ...us]));
  const syncDetail = (u: AdminUser) => setDetail((d) => (d && d.id === u.id ? u : d));
  const close = () => setModal(null);
  const fail = (e: unknown) => toast(toApiError(e));
  const revealStatusIfFiltered = (status: AdminUserStatus) => {
    setStatusF((current) => (current === 'all' || current === status ? current : status));
  };

  function onAction(a: UserAction, u: AdminUser) {
    if (a === 'view') return setDetail(u);
    if (a === 'edit') return setModal({ type: 'form', mode: 'edit', user: u });
    if (a === 'roles') return setModal({ type: 'roles', user: u });
    if (a === 'reset') return setModal({ type: 'reset', user: u });
    if (a === 'lock') return setModal({ type: 'lock', user: u, locking: true });
    if (a === 'unlock') return setModal({ type: 'lock', user: u, locking: false });
    if (a === 'activate') return setModal({ type: 'activate', user: u });
    if (a === 'delete') return setModal({ type: 'delete', user: u });
  }

  async function submitForm(f: UserForm) {
    try {
      if (f.id) {
        const u = await adminUsersApi.update(f.id, { name: f.name, email: f.email, phone: f.phone, shift: f.shift, role: f.role });
        upsert(u);
        syncDetail(u);
        toast(t('t_updated'));
      } else {
        const u = await adminUsersApi.create({ name: f.name, username: f.username, email: f.email, phone: f.phone, shift: f.shift, role: f.role, sendInvite: f.sendInvite });
        upsert(u);
        toast(t('t_created'));
      }
      close();
    } catch (e) {
      fail(e);
    }
  }
  async function submitRoles(role: Role) {
    if (modal?.type !== 'roles') return;
    try {
      const u = await adminUsersApi.setRole(modal.user.id, role);
      upsert(u);
      syncDetail(u);
      toast(t('t_role'));
      close();
    } catch (e) {
      fail(e);
    }
  }
  async function submitReset() {
    if (modal?.type !== 'reset') return;
    try {
      await adminUsersApi.resetPassword(modal.user.id);
      toast(t('t_reset'));
      close();
    } catch (e) {
      fail(e);
    }
  }
  async function submitLock(reason: string) {
    if (modal?.type !== 'lock') return;
    const { user, locking } = modal;
    try {
      const u = locking ? await adminUsersApi.lock(user.id, reason) : await adminUsersApi.unlock(user.id);
      upsert(u);
      syncDetail(u);
      revealStatusIfFiltered(u.status);
      toast(locking ? t('t_locked') : t('t_unlocked'));
      close();
    } catch (e) {
      fail(e);
    }
  }
  async function submitActivate() {
    if (modal?.type !== 'activate') return;
    try {
      const u = await adminUsersApi.activate(modal.user.id);
      upsert(u);
      syncDetail(u);
      revealStatusIfFiltered(u.status);
      toast(t('t_activated'));
      close();
    } catch (e) {
      fail(e);
    }
  }
  async function submitDelete() {
    if (modal?.type !== 'delete') return;
    const u = modal.user;
    try {
      const deactivated = await adminUsersApi.remove(u.id);
      upsert(deactivated);
      syncDetail(deactivated);
      revealStatusIfFiltered(deactivated.status);
      toast(t('t_deleted'));
      close();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <main className="page-scroll">
      <div className="page-inner um-page">
        <div className="page-head">
          <Eyebrow>{t('um_eyebrow')}</Eyebrow>
          <h1 className="page-title serif">{t('um_title')}</h1>
          <p className="page-lede">{t('um_lede')}</p>
        </div>

        <div className="um-toolbar">
          <div className="um-toolbar-title">
            <b>{t('um_nav')}</b>
            <span className="um-count">{filtered.length}</span>
          </div>
          <div className="um-search">
            <TextInput value={search} onChange={setSearch} placeholder={t('um_search_ph')} icon="search" />
          </div>
          <FilterSelect value={roleF} onChange={setRoleF} options={[{ value: 'all', label: t('um_all') }, { value: 'operator', label: t('role_operator') }, { value: 'admin', label: t('role_admin') }]} />
          <FilterSelect value={statusF} onChange={setStatusF} options={[{ value: 'all', label: t('um_all') }, { value: 'active', label: t('st_active') }, { value: 'locked', label: t('st_locked') }, { value: 'invited', label: t('st_invited') }, { value: 'inactive', label: t('st_inactive') }]} />
          <Button size="sm" icon="plus" onClick={() => setModal({ type: 'form', mode: 'create', user: null })}>{t('um_add')}</Button>
        </div>

        {filtered.length === 0 ? (
          <div className="um-empty">
            <div className="um-empty-mark"><Icon name="search" size={24} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{t('um_no_results')}</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4 }}>{t('um_no_results_hint')}</div>
          </div>
        ) : (
          <div className="um-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="um-table">
              <thead>
                <tr>
                  <th>{t('col_user')}</th>
                  <th>{t('col_role')}</th>
                  <th>{t('col_status')}</th>
                  <th>{t('col_lastactive')}</th>
                  <th style={{ width: 52 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="um-row" onClick={() => setDetail(u)}>
                    <td>
                      <div className="um-user">
                        <Avatar name={u.name} size={38} />
                        <div style={{ minWidth: 0 }}>
                          <div className="um-user-name">{u.name}</div>
                          <div className="um-user-sub">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><RolePill role={u.role} t={t} /></td>
                    <td><StatusBadge status={u.status} t={t} /></td>
                    <td className="um-cell-muted">{relTime(u.lastActive, t)}</td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <RowMenu user={u} onAction={onAction} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DetailDrawer user={detail} onClose={() => setDetail(null)} onAction={onAction} t={t} lang={lang} />

      <UserFormModal open={modal?.type === 'form'} mode={modal?.type === 'form' ? modal.mode : 'create'} user={modal?.type === 'form' ? modal.user : null} users={users} onClose={close} onSubmit={submitForm} t={t} />
      <RolesModal open={modal?.type === 'roles'} user={modal?.type === 'roles' ? modal.user : null} onClose={close} onSubmit={submitRoles} t={t} />
      <ResetModal open={modal?.type === 'reset'} user={modal?.type === 'reset' ? modal.user : null} onClose={close} onSubmit={submitReset} t={t} />
      <LockModal open={modal?.type === 'lock'} user={modal?.type === 'lock' ? modal.user : null} locking={modal?.type === 'lock' ? modal.locking : false} onClose={close} onSubmit={submitLock} t={t} />
      <ActivateModal open={modal?.type === 'activate'} user={modal?.type === 'activate' ? modal.user : null} onClose={close} onSubmit={submitActivate} t={t} />
      <DeleteModal open={modal?.type === 'delete'} user={modal?.type === 'delete' ? modal.user : null} onClose={close} onSubmit={submitDelete} t={t} />
    </main>
  );
}

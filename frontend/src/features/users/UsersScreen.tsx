import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui/controls';
import { Segmented } from '@/ui/controls';
import { TextInput, Field, Select } from '@/ui/fields';
import { Drawer } from '@/ui/overlay';
import { useToast } from '@/ui/toast';
import { usersApi } from '@/api/users';
import { toApiError } from '@/api/client';
import type { Lang, TFunc } from '@/i18n';
import type { Role, User } from '@/types/user';
import { TableView, CardsView, CompactView, EmptyState, type UserAction } from './views';
import { UserDetail } from './UserDetail';
import { UserFormModal, RolesModal, ResetPasswordModal, LockModal, DeleteModal, type UserForm } from './modals';

const PAGE_SIZE = 8;

type ModalState =
  | { type: 'form'; mode: 'create' | 'edit'; user: User | null }
  | { type: 'roles'; user: User }
  | { type: 'reset'; user: User }
  | { type: 'lock'; user: User; locking: boolean }
  | { type: 'delete'; user: User }
  | null;

/* ---------- filter popover ---------- */
function FilterPopover({
  roleF,
  setRoleF,
  statusF,
  setStatusF,
  t,
}: {
  roleF: string;
  setRoleF: (v: string) => void;
  statusF: string;
  setStatusF: (v: string) => void;
  t: TFunc;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const n = (roleF !== 'all' ? 1 : 0) + (statusF !== 'all' ? 1 : 0);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant="default" icon="filter" onClick={() => setOpen((o) => !o)}>
        {t('filters')}
        {n > 0 && (
          <span style={{ marginLeft: 2, fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-tint)', borderRadius: 999, padding: '0 7px' }}>
            {n}
          </span>
        )}
      </Button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 40,
            width: 240,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            padding: 14,
            animation: 'popIn .12s ease',
          }}
        >
          <Field label={t('filter_role')}>
            <Select
              value={roleF}
              onChange={setRoleF}
              options={[
                { value: 'all', label: t('all') },
                { value: 'operator', label: t('role_operator') },
                { value: 'admin', label: t('role_admin') },
              ]}
            />
          </Field>
          <div style={{ height: 12 }} />
          <Field label={t('filter_status')}>
            <Select
              value={statusF}
              onChange={setStatusF}
              options={[
                { value: 'all', label: t('all') },
                { value: 'active', label: t('st_active') },
                { value: 'locked', label: t('st_locked') },
                { value: 'invited', label: t('st_invited') },
                { value: 'inactive', label: t('st_inactive') },
              ]}
            />
          </Field>
          {n > 0 && (
            <Button
              variant="ghost"
              full
              onClick={() => {
                setRoleF('all');
                setStatusF('all');
              }}
              style={{ marginTop: 12 }}
            >
              {t('filters_clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- pagination ---------- */
function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const PBtn = ({ p }: { p: number }) => (
    <button
      onClick={() => setPage(p)}
      style={{
        minWidth: 36,
        height: 36,
        borderRadius: 8,
        border: '1px solid ' + (p === page ? 'var(--border-strong)' : 'transparent'),
        background: p === page ? 'var(--subtle)' : 'transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 13.5,
        fontWeight: p === page ? 600 : 500,
        color: p === page ? 'var(--text)' : 'var(--text-muted)',
      }}
      onMouseEnter={(e) => {
        if (p !== page) e.currentTarget.style.background = 'var(--subtle)';
      }}
      onMouseLeave={(e) => {
        if (p !== page) e.currentTarget.style.background = 'transparent';
      }}
    >
      {p}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 4px 4px', gap: 12 }}>
      <Button variant="default" size="sm" icon="chevright" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} style={{ transform: 'scaleX(-1)' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {pages.map((p) => (
          <PBtn key={p} p={p} />
        ))}
      </div>
      <Button variant="default" size="sm" icon="chevright" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} />
    </div>
  );
}

/* ---------- screen ---------- */
export function UsersScreen({ t, lang }: { t: TFunc; lang: Lang }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [roleF, setRoleF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [view, setView] = useState<'table' | 'cards' | 'compact'>('table');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<User | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [sortKey, setSortKey] = useState('lastActive');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Load the full user list once; filtering/sort/paging happen client-side.
  useEffect(() => {
    usersApi
      .list({})
      .then(setUsers)
      .catch((err) => toast(toApiError(err), { tone: 'danger' }));
  }, [toast]);

  useEffect(() => {
    setPage(1);
  }, [search, roleF, statusF, sortKey, sortDir, view]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter(
      (u) =>
        (roleF === 'all' || u.role === roleF) &&
        (statusF === 'all' || u.status === statusF) &&
        (!q || u.name.toLowerCase().includes(q) || u.username.includes(q) || u.email.toLowerCase().includes(q)),
    );
    const ts = (v: string | null) => (v ? new Date(v).getTime() : 0);
    return [...list].sort((a, b) => {
      const d = ts((a as never)[sortKey]) - ts((b as never)[sortKey]);
      return sortDir === 'asc' ? d : -d;
    });
  }, [users, search, roleF, statusF, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const paged = view === 'table' ? filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE) : filtered;

  const filteredIds = paged.map((u) => u.id);
  const selInPage = filteredIds.filter((id) => selected.has(id));
  const allSel = paged.length > 0 && selInPage.length === paged.length;
  const someSel = selInPage.length > 0 && !allSel;
  const selAll = filtered.filter((u) => selected.has(u.id)).length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSel) filteredIds.forEach((id) => n.delete(id));
      else filteredIds.forEach((id) => n.add(id));
      return n;
    });
  const clearSel = () => setSelected(new Set());

  const upsert = (u: User) => setUsers((us) => (us.some((x) => x.id === u.id) ? us.map((x) => (x.id === u.id ? u : x)) : [u, ...us]));
  const syncDetail = (u: User) => setDetail((d) => (d && d.id === u.id ? u : d));
  const closeModal = () => setModal(null);

  const onAction: (type: UserAction, user?: User) => void = (type, user) => {
    if (type === 'create') return setModal({ type: 'form', mode: 'create', user: null });
    if (!user) return;
    if (type === 'view') return setDetail(user);
    if (type === 'edit') return setModal({ type: 'form', mode: 'edit', user });
    if (type === 'roles') return setModal({ type: 'roles', user });
    if (type === 'reset') return setModal({ type: 'reset', user });
    if (type === 'lock') return setModal({ type: 'lock', user, locking: true });
    if (type === 'unlock') return setModal({ type: 'lock', user, locking: false });
    if (type === 'delete') return setModal({ type: 'delete', user });
  };

  const fail = (err: unknown) => toast(toApiError(err), { tone: 'danger' });

  async function submitForm(form: UserForm) {
    try {
      if (form.id) {
        const updated = await usersApi.update(form.id, {
          name: form.name,
          email: form.email,
          phone: form.phone,
          shift: form.shift,
          role: form.role,
        });
        upsert(updated);
        syncDetail(updated);
        toast(t('toast_updated'), { desc: updated.name, actions: [{ label: t('view_profile'), primary: true, onClick: () => setDetail(updated) }] });
      } else {
        const created = await usersApi.create({
          name: form.name,
          username: form.username,
          email: form.email,
          phone: form.phone,
          shift: form.shift,
          role: form.role,
          sendInvite: form.sendInvite,
        });
        upsert(created);
        toast(t('toast_created'), { desc: created.name, actions: [{ label: t('view_profile'), primary: true, onClick: () => setDetail(created) }] });
      }
      closeModal();
    } catch (err) {
      fail(err);
    }
  }

  async function submitRoles(role: Role) {
    if (modal?.type !== 'roles') return;
    try {
      const u = await usersApi.setRole(modal.user.id, role);
      upsert(u);
      syncDetail(u);
      toast(t('toast_role'), { desc: u.name });
      closeModal();
    } catch (err) {
      fail(err);
    }
  }

  async function submitReset(method: 'link' | 'temp', force: boolean) {
    if (modal?.type !== 'reset') return;
    try {
      await usersApi.resetPassword(modal.user.id, method, force);
      toast(t('toast_reset'), { desc: modal.user.name });
      closeModal();
    } catch (err) {
      fail(err);
    }
  }

  async function submitLock(reason: string) {
    if (modal?.type !== 'lock') return;
    const { user, locking } = modal;
    try {
      const u = locking ? await usersApi.lock(user.id, reason) : await usersApi.unlock(user.id);
      upsert(u);
      syncDetail(u);
      toast(locking ? t('toast_locked') : t('toast_unlocked'), { desc: u.name, tone: locking ? 'danger' : 'success' });
      closeModal();
    } catch (err) {
      fail(err);
    }
  }

  async function submitDelete() {
    if (modal?.type !== 'delete') return;
    const u = modal.user;
    try {
      await usersApi.remove(u.id);
      setUsers((us) => us.filter((x) => x.id !== u.id));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(u.id);
        return n;
      });
      if (detail?.id === u.id) setDetail(null);
      toast(t('toast_deleted'), { desc: u.name, tone: 'danger' });
      closeModal();
    } catch (err) {
      fail(err);
    }
  }

  async function bulkLock(lock: boolean) {
    try {
      await Promise.all(selInPage.map((id) => (lock ? usersApi.lock(id) : usersApi.unlock(id))));
      const refreshed = await usersApi.list({});
      setUsers(refreshed);
      toast(lock ? t('toast_locked') : t('toast_unlocked'), { desc: `${selInPage.length} ${t('users_lc')}`, tone: lock ? 'danger' : 'success' });
      clearSel();
    } catch (err) {
      fail(err);
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => usersApi.remove(id)));
      setUsers((us) => us.filter((u) => !ids.includes(u.id)));
      toast(t('toast_deleted'), { desc: `${selAll} ${t('users_lc')}`, tone: 'danger' });
      clearSel();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <>
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 28px 36px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.02em' }}>{t('users_title')}</h1>
          <p style={{ margin: '6px 0 26px', fontSize: 14.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('users_desc')}</p>

          {/* toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flex: 1, minWidth: 160 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{t('all_users')}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--subtle)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 9px' }}>
                {filtered.length}
              </span>
            </div>
            <div style={{ width: 240, minWidth: 180 }}>
              <TextInput value={search} onChange={setSearch} placeholder={t('search_ph')} prefixIcon="search" />
            </div>
            <Segmented
              value={view}
              onChange={(v) => setView(v as 'table' | 'cards' | 'compact')}
              options={[
                { value: 'table', icon: 'table', label: '' },
                { value: 'cards', icon: 'cards', label: '' },
                { value: 'compact', icon: 'rows', label: '' },
              ]}
            />
            <FilterPopover roleF={roleF} setRoleF={setRoleF} statusF={statusF} setStatusF={setStatusF} t={t} />
            <Button variant="dark" icon="plus" onClick={() => onAction('create')}>
              {t('add_user')}
            </Button>
          </div>

          {/* bulk bar */}
          {selAll > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                marginBottom: 14,
                background: 'var(--accent-tint)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius)',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent-fg)' }}>
                {selAll} {t('bulk_selected')}
              </span>
              <div style={{ flex: 1 }} />
              <Button size="sm" variant="default" icon="lock" onClick={() => bulkLock(true)}>
                {t('bulk_lock')}
              </Button>
              <Button size="sm" variant="default" icon="unlock" onClick={() => bulkLock(false)}>
                {t('bulk_unlock')}
              </Button>
              <Button size="sm" variant="danger-ghost" icon="trash" onClick={bulkDelete}>
                {t('bulk_delete')}
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSel}>
                {t('bulk_clear')}
              </Button>
            </div>
          )}

          {/* views */}
          {filtered.length === 0 ? (
            <EmptyState t={t} />
          ) : view === 'table' ? (
            <>
              <TableView
                users={paged}
                selected={selected}
                toggle={toggle}
                toggleAll={toggleAll}
                allSel={allSel}
                someSel={someSel}
                onOpen={setDetail}
                onAction={onAction}
                t={t}
                lang={lang}
                density="regular"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <Pagination page={curPage} totalPages={totalPages} setPage={setPage} />
            </>
          ) : view === 'cards' ? (
            <CardsView users={paged} selected={selected} toggle={toggle} onOpen={setDetail} onAction={onAction} t={t} lang={lang} />
          ) : (
            <CompactView users={paged} selected={selected} toggle={toggle} onOpen={setDetail} onAction={onAction} t={t} lang={lang} />
          )}
        </div>
      </main>

      {/* drawer */}
      <Drawer open={!!detail} onClose={() => setDetail(null)}>
        <UserDetail user={detail} onClose={() => setDetail(null)} onAction={onAction} t={t} lang={lang} />
      </Drawer>

      {/* modals */}
      <UserFormModal
        open={modal?.type === 'form'}
        mode={modal?.type === 'form' ? modal.mode : 'create'}
        user={modal?.type === 'form' ? modal.user : null}
        users={users}
        onClose={closeModal}
        onSubmit={submitForm}
        t={t}
      />
      <RolesModal open={modal?.type === 'roles'} user={modal?.type === 'roles' ? modal.user : null} onClose={closeModal} onSubmit={submitRoles} t={t} lang={lang} />
      <ResetPasswordModal open={modal?.type === 'reset'} user={modal?.type === 'reset' ? modal.user : null} onClose={closeModal} onSubmit={submitReset} t={t} />
      <LockModal
        open={modal?.type === 'lock'}
        user={modal?.type === 'lock' ? modal.user : null}
        locking={modal?.type === 'lock' ? modal.locking : false}
        onClose={closeModal}
        onSubmit={submitLock}
        t={t}
      />
      <DeleteModal open={modal?.type === 'delete'} user={modal?.type === 'delete' ? modal.user : null} onClose={closeModal} onSubmit={submitDelete} t={t} />
    </>
  );
}

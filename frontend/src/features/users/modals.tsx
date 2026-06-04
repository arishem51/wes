import { useEffect, useState } from 'react';
import { Icon } from '@/lib/icons';
import { Button, IconButton, Toggle } from '@/ui/controls';
import { Field, TextInput, Select } from '@/ui/fields';
import { Modal } from '@/ui/overlay';
import { PermissionList } from './PermissionList';
import type { Lang, TFunc } from '@/i18n';
import type { Role, User } from '@/types/user';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9._]+$/;

export function genPassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    b = 'abcdefghijkmnpqrstuvwxyz',
    n = '23456789',
    s = '!@#$%';
  const pick = (set: string, k: number) =>
    Array.from({ length: k }, () => set[Math.floor(Math.random() * set.length)]).join('');
  return (pick(a, 2) + pick(b, 4) + pick(n, 3) + pick(s, 1))
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export interface UserForm {
  id?: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  shift: string;
  role: Role;
  status: User['status'];
  sendInvite: boolean;
}

const SHIFTS = ['Hành chính', 'Ca A (06–14h)', 'Ca B (14–22h)', 'Ca C (22–06h)'];

/* ===== Create / Edit ===== */
export function UserFormModal({
  open,
  mode,
  user,
  users,
  onClose,
  onSubmit,
  t,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  user: User | null;
  users: User[];
  onClose: () => void;
  onSubmit: (form: UserForm) => void;
  t: TFunc;
}) {
  const blank: UserForm = {
    name: '',
    username: '',
    email: '',
    phone: '',
    shift: 'Ca A (06–14h)',
    role: 'operator',
    status: 'active',
    sendInvite: true,
  };
  const [form, setForm] = useState<UserForm>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, number>>({});

  useEffect(() => {
    if (open) {
      setForm(mode === 'edit' && user ? { ...user, sendInvite: false } : blank);
      setErrors({});
      setTouched({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, user]);

  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function validate(f: UserForm): Record<string, string> {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = t('err_required');
    if (!f.username.trim()) e.username = t('err_required');
    else if (!USERNAME_RE.test(f.username)) e.username = t('err_username');
    else if (users.some((u) => u.username === f.username && u.id !== (user && user.id))) e.username = t('err_username_taken');
    if (!f.email.trim()) e.email = t('err_required');
    else if (!EMAIL_RE.test(f.email)) e.email = t('err_email');
    else if (users.some((u) => u.email.toLowerCase() === f.email.toLowerCase() && u.id !== (user && user.id)))
      e.email = t('err_email_taken');
    return e;
  }

  useEffect(() => {
    if (Object.keys(touched).length) setErrors(validate(form));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  function submit() {
    const e = validate(form);
    setErrors(e);
    setTouched({ name: 1, username: 1, email: 1 });
    if (Object.keys(e).length) return;
    onSubmit(form);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      icon={mode === 'edit' ? 'edit' : 'plus'}
      title={mode === 'edit' ? t('edit_title') : t('create_title')}
      subtitle={mode === 'edit' ? user?.name : t('users_desc')}
      footer={
        <>
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="dark" onClick={submit} icon={mode === 'edit' ? 'check' : 'plus'}>
            {mode === 'edit' ? t('save') : t('create_btn')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label={t('field_fullname')} required error={touched.name && errors.name}>
          <TextInput
            value={form.name}
            onChange={(v) => set('name', v)}
            placeholder={t('ph_fullname')}
            autoFocus
            onBlur={() => setTouched((x) => ({ ...x, name: 1 }))}
            error={touched.name && errors.name}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label={t('field_username')} required error={touched.username && errors.username}>
            <TextInput
              value={form.username}
              onChange={(v) => set('username', v.toLowerCase())}
              placeholder={t('ph_username')}
              mono
              onBlur={() => setTouched((x) => ({ ...x, username: 1 }))}
              error={touched.username && errors.username}
            />
          </Field>
          <Field label={t('field_phone')}>
            <TextInput value={form.phone} onChange={(v) => set('phone', v)} placeholder={t('ph_phone')} prefixIcon="phone" />
          </Field>
        </div>
        <Field label={t('field_email')} required error={touched.email && errors.email}>
          <TextInput
            value={form.email}
            onChange={(v) => set('email', v)}
            placeholder={t('ph_email')}
            prefixIcon="mail"
            type="email"
            onBlur={() => setTouched((x) => ({ ...x, email: 1 }))}
            error={touched.email && errors.email}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label={t('field_role')}>
            <Select
              value={form.role}
              onChange={(v) => set('role', v as Role)}
              options={[
                { value: 'operator', label: t('role_operator') },
                { value: 'admin', label: t('role_admin') },
              ]}
            />
          </Field>
          <Field label={t('field_shift')}>
            <Select value={form.shift} onChange={(v) => set('shift', v)} options={SHIFTS.map((s) => ({ value: s, label: s }))} />
          </Field>
        </div>
        <div
          style={{
            padding: '11px 13px',
            borderRadius: 'var(--radius)',
            background: form.role === 'admin' ? 'var(--role-admin-bg)' : 'var(--role-op-bg)',
            border: `1px solid ${form.role === 'admin' ? 'var(--role-admin-bd)' : 'var(--role-op-bd)'}`,
            display: 'flex',
            gap: 10,
          }}
        >
          <Icon
            name={form.role === 'admin' ? 'shield' : 'user'}
            size={17}
            style={{ color: form.role === 'admin' ? 'var(--role-admin-fg)' : 'var(--role-op-fg)', flexShrink: 0, marginTop: 1 }}
          />
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
            {form.role === 'admin' ? t('role_admin_desc') : t('role_operator_desc')}
          </span>
        </div>
        {mode === 'create' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2 }}>
            <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{t('send_invite')}</span>
            <Toggle checked={form.sendInvite} onChange={(v) => set('sendInvite', v)} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ===== Reset password ===== */
export function ResetPasswordModal({
  open,
  user,
  onClose,
  onSubmit,
  t,
}: {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSubmit: (method: 'link' | 'temp', force: boolean) => void;
  t: TFunc;
}) {
  const [method, setMethod] = useState<'link' | 'temp'>('link');
  const [pwd, setPwd] = useState('');
  const [copied, setCopied] = useState(false);
  const [force, setForce] = useState(true);
  useEffect(() => {
    if (open) {
      setMethod('link');
      setPwd(genPassword());
      setCopied(false);
      setForce(true);
    }
  }, [open]);
  if (!user) return null;
  const copy = () => {
    navigator.clipboard && navigator.clipboard.writeText(pwd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const Opt = ({ id, title, desc }: { id: 'link' | 'temp'; title: string; desc: string }) => (
    <button
      onClick={() => setMethod(id)}
      style={{
        display: 'flex',
        gap: 11,
        textAlign: 'left',
        width: '100%',
        padding: '12px 13px',
        cursor: 'pointer',
        borderRadius: 'var(--radius)',
        background: method === id ? 'var(--accent-tint)' : 'var(--surface)',
        border: `1px solid ${method === id ? 'var(--accent)' : 'var(--border)'}`,
        transition: 'all .12s',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          border: `2px solid ${method === id ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: method === id ? 'var(--accent)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {method === id && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
      </span>
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{desc}</span>
      </span>
    </button>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      icon="key"
      title={t('reset_title')}
      subtitle={`${t('reset_for')} ${user.name} · @${user.username}`}
      footer={
        <>
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="dark" icon="key" onClick={() => onSubmit(method, force)}>
            {t('reset_confirm')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Opt id="link" title={t('reset_link')} desc={t('reset_link_desc')} />
        <Opt id="temp" title={t('reset_temp')} desc={t('reset_temp_desc')} />
        {method === 'temp' && (
          <div style={{ marginTop: 2 }}>
            <Field label={t('reset_temp_pwd')}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div
                  style={{
                    flex: 1,
                    fontFamily: 'var(--mono)',
                    fontSize: 15,
                    letterSpacing: '.04em',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--subtle)',
                    border: '1px dashed var(--border-strong)',
                    color: 'var(--text)',
                  }}
                >
                  {pwd}
                </div>
                <Button variant="default" icon={copied ? 'check' : 'copy'} onClick={copy}>
                  {copied ? t('reset_copied') : t('reset_copy')}
                </Button>
                <IconButton name="refresh" label={t('reset_regenerate')} onClick={() => setPwd(genPassword())} />
              </div>
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
              <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{t('force_change')}</span>
              <Toggle checked={force} onChange={setForce} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ===== Lock / Unlock ===== */
export function LockModal({
  open,
  user,
  locking,
  onClose,
  onSubmit,
  t,
}: {
  open: boolean;
  user: User | null;
  locking: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  t: TFunc;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  if (!user) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={460}
      icon={locking ? 'lock' : 'unlock'}
      iconTone={locking ? 'warn' : 'accent'}
      title={locking ? t('lock_title') : t('unlock_title')}
      subtitle={`${user.name} · @${user.username}`}
      footer={
        <>
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant={locking ? 'danger' : 'dark'} icon={locking ? 'lock' : 'unlock'} onClick={() => onSubmit(reason)}>
            {locking ? t('lock_confirm') : t('unlock_confirm')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {locking ? t('lock_warn') : t('unlock_warn')}
      </p>
      {locking && (
        <Field label={t('lock_reason')}>
          <TextInput value={reason} onChange={setReason} placeholder={t('lock_reason_ph')} />
        </Field>
      )}
      {!locking && user.lockReason && (
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--text-muted)',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--subtle)',
          }}
        >
          <span style={{ color: 'var(--text-faint)' }}>{t('lock_reason')}: </span>
          {user.lockReason}
        </div>
      )}
    </Modal>
  );
}

/* ===== Delete ===== */
export function DeleteModal({
  open,
  user,
  onClose,
  onSubmit,
  t,
}: {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSubmit: () => void;
  t: TFunc;
}) {
  const [val, setVal] = useState('');
  useEffect(() => {
    if (open) setVal('');
  }, [open]);
  if (!user) return null;
  const match = val === user.username;
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={460}
      icon="trash"
      iconTone="danger"
      title={t('delete_title')}
      subtitle={`${user.name} · @${user.username}`}
      footer={
        <>
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="danger" icon="trash" disabled={!match} onClick={() => onSubmit()}>
            {t('delete_confirm')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{t('delete_warn')}</p>
      <Field label={t('delete_type')} error={val && !match ? t('delete_mismatch') : null}>
        <TextInput value={val} onChange={setVal} placeholder={user.username} mono error={Boolean(val) && !match} autoFocus />
      </Field>
    </Modal>
  );
}

/* ===== Roles & access ===== */
export function RolesModal({
  open,
  user,
  onClose,
  onSubmit,
  t,
  lang,
}: {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSubmit: (role: Role) => void;
  t: TFunc;
  lang: Lang;
}) {
  const [role, setRole] = useState<Role>('operator');
  useEffect(() => {
    if (open && user) setRole(user.role);
  }, [open, user]);
  if (!user) return null;
  const RoleCard = ({ id }: { id: Role }) => {
    const active = role === id,
      isAdmin = id === 'admin';
    return (
      <button
        onClick={() => setRole(id)}
        style={{
          flex: 1,
          textAlign: 'left',
          padding: '13px 14px',
          cursor: 'pointer',
          borderRadius: 'var(--radius)',
          background: active ? 'var(--accent-tint)' : 'var(--surface)',
          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          transition: 'all .12s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon name={isAdmin ? 'shield' : 'user'} size={17} style={{ color: isAdmin ? 'var(--role-admin-fg)' : 'var(--role-op-fg)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{isAdmin ? t('role_admin') : t('role_operator')}</span>
          {active && <Icon name="check" size={15} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          {isAdmin ? t('role_admin_desc') : t('role_operator_desc')}
        </span>
      </button>
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={540}
      icon="shield"
      title={t('roles_title')}
      subtitle={`${user.name} · @${user.username}`}
      footer={
        <>
          <Button variant="default" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="dark" icon="check" onClick={() => onSubmit(role)}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 9 }}>
        {t('roles_pick')}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <RoleCard id="operator" />
        <RoleCard id="admin" />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 9 }}>
        {t('detail_perms')}
      </div>
      <PermissionList role={role} t={t} lang={lang} />
      <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('roles_note')}</p>
    </Modal>
  );
}

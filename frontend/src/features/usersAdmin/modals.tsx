import { useEffect, useState } from 'react';
import { Icon } from '@/ui/icons';
import { Button, Toggle } from '@/ui/controls';
import { Field, TextInput } from '@/ui/fields';
import { Modal } from '@/ui/overlay';
import { PermissionList } from './Permissions';
import type { TFunc } from '@/i18n';
import type { AdminUser, Role } from '@/types/adminUser';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9._]+$/;
const SHIFTS = ['Hành chính', 'Ca A (06–14h)', 'Ca B (14–22h)', 'Ca C (22–06h)'];

export function genPassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', b = 'abcdefghijkmnpqrstuvwxyz', n = '23456789', s = '!@#$%';
  const pick = (set: string, k: number) => Array.from({ length: k }, () => set[Math.floor(Math.random() * set.length)]).join('');
  return (pick(a, 2) + pick(b, 4) + pick(n, 3) + pick(s, 1)).split('').sort(() => Math.random() - 0.5).join('');
}

function ModalHead({ icon, tone, title, sub }: { icon: string; tone?: 'danger' | 'warn'; title: string; sub?: string }) {
  return (
    <div className="modal-head">
      <div className={'modal-ic' + (tone ? ' ' + tone : '')}>
        <Icon name={icon} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="modal-title">{title}</div>
        {sub && <div className="modal-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="um-filter" style={{ width: '100%' }}>
      <select className="um-select" style={{ width: '100%', height: 50, borderRadius: 13 }} value={value} onChange={(e) => onChange(e.target.value)}>
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

export interface UserForm {
  id?: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  shift: string;
  role: Role;
  sendInvite: boolean;
}

/* Create / Edit */
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
  user: AdminUser | null;
  users: AdminUser[];
  onClose: () => void;
  onSubmit: (f: UserForm) => void;
  t: TFunc;
}) {
  const blank: UserForm = { name: '', username: '', email: '', phone: '', shift: 'Ca A (06–14h)', role: 'operator', sendInvite: true };
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

  function validate(f: UserForm) {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = t('err_required');
    if (!f.username.trim()) e.username = t('err_required');
    else if (!USERNAME_RE.test(f.username)) e.username = t('err_username');
    else if (users.some((u) => u.username === f.username && u.id !== user?.id)) e.username = t('err_username_taken');
    if (!f.email.trim()) e.email = t('err_required');
    else if (!EMAIL_RE.test(f.email)) e.email = t('err_email');
    else if (users.some((u) => u.email.toLowerCase() === f.email.toLowerCase() && u.id !== user?.id)) e.email = t('err_email_taken');
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
    <Modal open={open} onClose={onClose} width={540}>
      <ModalHead icon={mode === 'edit' ? 'edit' : 'user'} title={mode === 'edit' ? t('m_edit_title') : t('m_create_title')} sub={mode === 'edit' ? user?.name : t('um_lede')} />
      <div className="modal-content">
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label={t('field_fullname')} error={touched.name && errors.name}>
            <TextInput value={form.name} onChange={(v) => set('name', v)} placeholder={t('ph_fullname')} icon="user" autoFocus onBlur={() => setTouched((x) => ({ ...x, name: 1 }))} error={touched.name && errors.name} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label={t('field_username')} error={touched.username && errors.username}>
              <TextInput value={form.username} onChange={(v) => set('username', v.toLowerCase())} placeholder={t('ph_username')} onBlur={() => setTouched((x) => ({ ...x, username: 1 }))} error={touched.username && errors.username} />
            </Field>
            <Field label={t('field_phone')}>
              <TextInput value={form.phone} onChange={(v) => set('phone', v)} placeholder={t('ph_phone')} icon="phone" />
            </Field>
          </div>
          <Field label={t('field_email')} error={touched.email && errors.email}>
            <TextInput value={form.email} onChange={(v) => set('email', v)} placeholder={t('ph_email_um')} icon="mail" type="email" onBlur={() => setTouched((x) => ({ ...x, email: 1 }))} error={touched.email && errors.email} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label={t('field_role')}>
              <Select value={form.role} onChange={(v) => set('role', v as Role)} options={[{ value: 'operator', label: t('role_operator') }, { value: 'admin', label: t('role_admin') }]} />
            </Field>
            <Field label={t('field_shift')}>
              <Select value={form.shift} onChange={(v) => set('shift', v)} options={SHIFTS.map((s) => ({ value: s, label: s }))} />
            </Field>
          </div>
          <div className={'role-info ' + form.role}>
            <Icon name={form.role === 'admin' ? 'shield' : 'user'} size={17} style={{ color: form.role === 'admin' ? 'var(--accent-deep)' : '#1c7d6b', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{form.role === 'admin' ? t('role_admin_desc') : t('role_operator_desc')}</span>
          </div>
          {mode === 'create' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{t('send_invite_um')}</span>
              <Toggle checked={form.sendInvite} onChange={(v) => set('sendInvite', v)} />
            </div>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" icon={mode === 'edit' ? 'check' : 'user'} onClick={submit}>
          {mode === 'edit' ? t('save_changes') : t('create_btn')}
        </Button>
      </div>
    </Modal>
  );
}

/* Roles */
export function RolesModal({ open, user, onClose, onSubmit, t }: { open: boolean; user: AdminUser | null; onClose: () => void; onSubmit: (r: Role) => void; t: TFunc }) {
  const [role, setRole] = useState<Role>('operator');
  useEffect(() => {
    if (open && user) setRole(user.role);
  }, [open, user]);
  if (!user) return null;
  const Card = ({ id }: { id: Role }) => {
    const active = role === id, isAdmin = id === 'admin';
    return (
      <button onClick={() => setRole(id)} className={'role-card' + (active ? ' active' : '')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon name={isAdmin ? 'shield' : 'user'} size={17} style={{ color: isAdmin ? 'var(--accent-deep)' : '#1c7d6b' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{isAdmin ? t('role_admin') : t('role_operator')}</span>
          {active && <Icon name="check" size={15} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>{isAdmin ? t('role_admin_desc') : t('role_operator_desc')}</span>
      </button>
    );
  };
  return (
    <Modal open={open} onClose={onClose} width={540}>
      <ModalHead icon="shield" title={t('roles_title')} sub={`${user.name} · @${user.username}`} />
      <div className="modal-content">
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 9 }}>{t('roles_pick')}</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <Card id="operator" />
          <Card id="admin" />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 9 }}>{t('d_perms')}</div>
        <PermissionList role={role} t={t} />
        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{t('roles_note')}</p>
      </div>
      <div className="modal-foot">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" icon="check" onClick={() => onSubmit(role)}>
          {t('save_changes')}
        </Button>
      </div>
    </Modal>
  );
}

/* Reset password */
export function ResetModal({ open, user, onClose, onSubmit, t }: { open: boolean; user: AdminUser | null; onClose: () => void; onSubmit: () => void; t: TFunc }) {
  const [method, setMethod] = useState<'link' | 'temp'>('link');
  const [pwd, setPwd] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setMethod('link');
      setPwd(genPassword());
      setCopied(false);
    }
  }, [open]);
  if (!user) return null;
  const Opt = ({ id, title, desc }: { id: 'link' | 'temp'; title: string; desc: string }) => (
    <button onClick={() => setMethod(id)} className={'role-card' + (method === id ? ' active' : '')} style={{ display: 'flex', gap: 11 }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1, border: `2px solid ${method === id ? 'var(--accent)' : 'var(--paper-edge)'}`, background: method === id ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {method === id && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
      </span>
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>{desc}</span>
      </span>
    </button>
  );
  return (
    <Modal open={open} onClose={onClose} width={480}>
      <ModalHead icon="key" title={t('ar_title')} sub={`${user.name} · @${user.username}`} />
      <div className="modal-content">
        <div style={{ display: 'grid', gap: 10 }}>
          <Opt id="link" title={t('ar_link')} desc={t('ar_link_d')} />
          <Opt id="temp" title={t('ar_temp')} desc={t('ar_temp_d')} />
          {method === 'temp' && (
            <Field label={t('ar_temp_pwd')}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 15, letterSpacing: '.04em', padding: '12px 14px', borderRadius: 12, background: 'var(--paper-elevated)', border: '1px dashed var(--paper-edge)', color: 'var(--ink)' }}>{pwd}</div>
                <Button variant="secondary" size="sm" icon={copied ? 'check' : 'edit'} onClick={() => { navigator.clipboard?.writeText(pwd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? t('ar_copied') : t('ar_copy')}
                </Button>
              </div>
            </Field>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" icon="key" onClick={onSubmit}>
          {t('ar_confirm')}
        </Button>
      </div>
    </Modal>
  );
}

/* Lock / Unlock */
export function LockModal({ open, user, locking, onClose, onSubmit, t }: { open: boolean; user: AdminUser | null; locking: boolean; onClose: () => void; onSubmit: (reason: string) => void; t: TFunc }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  if (!user) return null;
  return (
    <Modal open={open} onClose={onClose} width={460}>
      <ModalHead icon={locking ? 'lock' : 'unlock'} tone={locking ? 'warn' : undefined} title={locking ? t('lk_title') : t('ulk_title')} sub={`${user.name} · @${user.username}`} />
      <div className="modal-content">
        <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{locking ? t('lk_warn') : t('ulk_warn')}</p>
        {locking && (
          <Field label={t('lk_reason')}>
            <TextInput value={reason} onChange={setReason} placeholder={t('lk_reason_ph')} />
          </Field>
        )}
        {!locking && user.lockReason && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', padding: '10px 12px', borderRadius: 10, background: 'var(--paper-elevated)' }}>
            <span style={{ color: 'var(--ink-3)' }}>{t('lk_reason')}: </span>
            {user.lockReason}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" icon={locking ? 'lock' : 'unlock'} onClick={() => onSubmit(reason)} style={locking ? { background: 'var(--red)' } : undefined}>
          {locking ? t('act_lock') : t('act_unlock')}
        </Button>
      </div>
    </Modal>
  );
}

/* Activate */
export function ActivateModal({ open, user, onClose, onSubmit, t }: { open: boolean; user: AdminUser | null; onClose: () => void; onSubmit: () => void; t: TFunc }) {
  if (!user) return null;
  return (
    <Modal open={open} onClose={onClose} width={460}>
      <ModalHead icon="check" title={t('actv_title')} sub={`${user.name} Â· @${user.username}`} />
      <div className="modal-content">
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{t('actv_warn')}</p>
      </div>
      <div className="modal-foot">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" icon="check" onClick={onSubmit}>
          {t('act_activate')}
        </Button>
      </div>
    </Modal>
  );
}

/* Delete */
export function DeleteModal({ open, user, onClose, onSubmit, t }: { open: boolean; user: AdminUser | null; onClose: () => void; onSubmit: () => void; t: TFunc }) {
  const [val, setVal] = useState('');
  useEffect(() => {
    if (open) setVal('');
  }, [open]);
  if (!user) return null;
  const match = val === user.username;
  return (
    <Modal open={open} onClose={onClose} width={460}>
      <ModalHead icon="trash" tone="danger" title={t('del_title')} sub={`${user.name} · @${user.username}`} />
      <div className="modal-content">
        <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{t('del_warn')}</p>
        <Field label={t('del_type')} error={val && !match ? t('del_mismatch') : null}>
          <TextInput value={val} onChange={setVal} placeholder={user.username} error={Boolean(val) && !match} autoFocus />
        </Field>
      </div>
      <div className="modal-foot">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="sm" icon="trash" disabled={!match} onClick={onSubmit} style={{ background: 'var(--red)' }}>
          {t('del_confirm')}
        </Button>
      </div>
    </Modal>
  );
}

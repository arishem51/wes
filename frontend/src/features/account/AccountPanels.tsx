import { useMemo, useState } from 'react';
import { Icon } from '@/ui/icons';
import { Button, Toggle, Segmented } from '@/ui/controls';
import { Field, TextInput } from '@/ui/fields';
import { Avatar, Card, SectionHead } from '@/ui/display';
import { accountApi } from '@/api/account';
import { toApiError } from '@/api/client';
import type { Lang, TFunc } from '@/i18n';
import type { AccountUser, Prefs } from '@/types/account';

function pwScore(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/\d/.test(pw)) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (pw.length >= 12 && /[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0..4
}

function ViewRow({ icon, label, value, mono }: { icon: string; label: string; value?: string; mono?: boolean }) {
  return (
    <div className="view-row">
      <span className="view-row-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="view-row-label">{label}</span>
      <span className="view-row-value" style={{ fontFamily: mono ? 'var(--mono)' : 'inherit' }}>
        {value || '—'}
      </span>
    </div>
  );
}

/* ════ PROFILE — UC-83 view / UC-84 edit ════ */
export function ProfilePanel({
  user,
  setUser,
  lang,
  t,
  toast,
}: {
  user: AccountUser;
  setUser: (u: AccountUser) => void;
  lang: Lang;
  t: TFunc;
  toast: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AccountUser>(user);
  const [saving, setSaving] = useState(false);

  function start() {
    setDraft(user);
    setEditing(true);
  }
  const set = <K extends keyof AccountUser>(k: K, v: AccountUser[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const updated = await accountApi.updateProfile({
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        shift: draft.shift,
        photo: draft.photo,
      });
      setUser(updated);
      setEditing(false);
      toast(t('toast_saved'));
    } catch (err) {
      toast(toApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const roleLabel = user.role === 'admin' ? t('role_admin') : t('role_operator');
  const created = new Date(user.created).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Card pad={0}>
      <div className="profile-banner">
        <div className="profile-banner-bg" />
        <div className="profile-identity">
          <Avatar name={user.name} src={user.photo} size={92} ring />
          <div style={{ minWidth: 0 }}>
            <div className="profile-name serif">{user.name}</div>
            <div className="profile-meta">
              <span className="tag">{roleLabel}</span>
              <span className="profile-since">
                <Icon name="clock" size={14} />
                {t('member_since')} {created}
              </span>
            </div>
          </div>
        </div>
        {!editing && (
          <Button variant="secondary" size="sm" icon="edit" onClick={start} style={{ position: 'relative', zIndex: 2 }}>
            {t('edit')}
          </Button>
        )}
      </div>

      <div style={{ padding: 26 }}>
        <SectionHead title={t('sec_profile')} desc={t('sec_profile_d')} />

        {!editing ? (
          <div className="view-list">
            <ViewRow icon="user" label={t('field_fullname')} value={user.name} />
            <ViewRow icon="mail" label={t('field_email')} value={user.email} mono />
            <ViewRow icon="phone" label={t('field_phone')} value={user.phone} mono />
            <ViewRow icon="clock" label={t('field_shift')} value={user.shift} />
            <ViewRow icon="shield" label={t('field_role')} value={roleLabel} />
            <ViewRow icon="globe" label={t('field_lang')} value={lang === 'vi' ? 'Tiếng Việt' : 'English'} />
          </div>
        ) : (
          <div className="edit-grid">
            <div className="photo-edit">
              <Avatar name={draft.name} src={draft.photo} size={72} />
              <div className="photo-edit-actions">
                <Button variant="secondary" size="sm" onClick={() => toast(t('toast_photo'))}>
                  {t('change_photo')}
                </Button>
                <button type="button" className="link danger" onClick={() => set('photo', null)}>
                  {t('remove_photo')}
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label={t('field_fullname')}>
                <TextInput value={draft.name} onChange={(v) => set('name', v)} icon="user" />
              </Field>
              <Field label={t('field_phone')}>
                <TextInput value={draft.phone} onChange={(v) => set('phone', v)} icon="phone" />
              </Field>
            </div>
            <Field label={t('field_email')}>
              <TextInput value={draft.email} onChange={(v) => set('email', v)} icon="mail" type="email" />
            </Field>
            <Field label={t('field_shift')}>
              <TextInput value={draft.shift} onChange={(v) => set('shift', v)} icon="clock" />
            </Field>
            <Field label={t('field_role')} hint={t('role_locked')}>
              <TextInput value={roleLabel} onChange={() => {}} icon="shield" disabled />
            </Field>
            <div className="form-actions">
              <Button variant="text" onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
              <Button icon="check" onClick={save} disabled={saving}>
                {t('save_changes')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ════ SECURITY — UC-85 change password + 2FA + sessions ════ */
export function SecurityPanel({
  t,
  lang,
  toast,
  twoFA,
  setTwoFA,
}: {
  t: TFunc;
  lang: Lang;
  toast: (s: string) => void;
  twoFA: boolean;
  setTwoFA: (v: boolean) => void;
}) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [cf, setCf] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const score = useMemo(() => pwScore(nw), [nw]);
  const meterLabels = [t('pw_weak'), t('pw_weak'), t('pw_fair'), t('pw_good'), t('pw_strong')];
  const meterColors = ['var(--red)', 'var(--red)', 'var(--saffron)', 'var(--blue)', 'var(--green)'];

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const er: Record<string, string> = {};
    if (!cur) er.cur = t('err_required');
    if (!nw) er.nw = t('err_required');
    else if (score < 2) er.nw = t('err_pw_weak');
    if (cf !== nw) er.cf = t('err_pw_match');
    setErrs(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      await accountApi.changePassword(cur, nw);
      setCur('');
      setNw('');
      setCf('');
      setErrs({});
      toast(t('toast_pw'));
    } catch (err) {
      setErrs({ cur: toApiError(err) });
    } finally {
      setSaving(false);
    }
  }

  const rules = [
    { ok: nw.length >= 8, label: t('pw_rule_len') },
    { ok: /\d/.test(nw), label: t('pw_rule_num') },
    { ok: /[a-z]/.test(nw) && /[A-Z]/.test(nw), label: t('pw_rule_case') },
  ];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <SectionHead title={t('sec_password')} desc={t('sec_password_d')} />
        <form onSubmit={submit} style={{ display: 'grid', gap: 16, maxWidth: 460 }}>
          <Field label={t('cur_password')} error={errs.cur}>
            <TextInput value={cur} onChange={setCur} type="password" icon="lock" />
          </Field>
          <Field label={t('new_password')} error={errs.nw}>
            <TextInput value={nw} onChange={setNw} type="password" icon="lock" />
          </Field>
          {nw && (
            <div className="pw-meter">
              <div className="pw-meter-track">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} style={{ background: i < score ? meterColors[score] : 'var(--paper-edge)' }} />
                ))}
              </div>
              <div className="pw-rules">
                <span className="pw-strength" style={{ color: meterColors[score] }}>
                  {t('pw_strength')}: {meterLabels[score]}
                </span>
                {rules.map((r, i) => (
                  <span key={i} className={'pw-rule' + (r.ok ? ' ok' : '')}>
                    <Icon name={r.ok ? 'check' : 'x'} size={13} stroke={2.6} />
                    {r.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Field label={t('confirm_password')} error={errs.cf}>
            <TextInput value={cf} onChange={setCf} type="password" icon="lock" />
          </Field>
          <div>
            <Button type="submit" icon="check" disabled={saving}>
              {t('update_password')}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="toggle-row">
          <div className="toggle-row-text">
            <h3 className="section-title" style={{ fontSize: 18 }}>
              {t('sec_2fa')}
            </h3>
            <p className="section-desc" style={{ marginTop: 4 }}>
              {t('sec_2fa_d')}
            </p>
          </div>
          <Toggle
            checked={twoFA}
            onChange={(v) => {
              setTwoFA(v);
              toast(v ? t('toast_2fa_on') : t('toast_2fa_off'));
            }}
          />
        </div>
      </Card>

      <Card>
        <SectionHead title={t('sec_sessions')} desc={t('sec_sessions_d')} />
        <div className="session-list">
          <div className="session-row">
            <span className="session-icon">
              <Icon name="laptop" size={20} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="session-name">
                Chrome · macOS<span className="session-current">{t('this_device')}</span>
              </div>
              <div className="session-meta">
                192.168.1.24 · {lang === 'vi' ? 'Hà Nội, VN' : 'Hanoi, VN'} · {lang === 'vi' ? 'vừa xong' : 'just now'}
              </div>
            </div>
            <span className="session-dot" />
          </div>
          <div className="session-row">
            <span className="session-icon">
              <Icon name="phone" size={20} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="session-name">Máy quét cầm tay · OPS-03</div>
              <div className="session-meta">
                10.0.4.11 · {lang === 'vi' ? 'Kho A' : 'Warehouse A'} · {lang === 'vi' ? '2 giờ trước' : '2h ago'}
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="link danger"
          style={{ marginTop: 16 }}
          onClick={async () => {
            try {
              await accountApi.signOutOthers();
              toast(t('toast_sessions'));
            } catch (err) {
              toast(toApiError(err));
            }
          }}
        >
          {t('signout_all')}
        </button>
      </Card>
    </div>
  );
}

/* ════ PREFERENCES ════ */
export function PreferencesPanel({
  t,
  lang,
  setLang,
  prefs,
  setPrefs,
  toast,
}: {
  t: TFunc;
  lang: Lang;
  setLang: (l: Lang) => void;
  prefs: Prefs;
  setPrefs: (updater: (p: Prefs) => Prefs) => void;
  toast: (s: string) => void;
}) {
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    toast(t('toast_pref'));
  };
  return (
    <Card>
      <SectionHead title={t('sec_prefs')} desc={t('sec_prefs_d')} />
      <div style={{ display: 'grid', gap: 4 }}>
        <div className="toggle-row bordered">
          <div className="toggle-row-text">
            <div className="pref-name">{t('field_lang')}</div>
          </div>
          <Segmented
            value={lang}
            onChange={(v) => setLang(v as Lang)}
            options={[
              { value: 'vi', label: 'Tiếng Việt' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
        <div className="toggle-row bordered">
          <div className="toggle-row-text">
            <div className="pref-name">{t('pref_notif')}</div>
            <div className="pref-desc">{t('pref_notif_d')}</div>
          </div>
          <Toggle checked={prefs.notif} onChange={(v) => set('notif', v)} />
        </div>
        <div className="toggle-row bordered">
          <div className="toggle-row-text">
            <div className="pref-name">{t('pref_sound')}</div>
            <div className="pref-desc">{t('pref_sound_d')}</div>
          </div>
          <Toggle checked={prefs.sound} onChange={(v) => set('sound', v)} />
        </div>
      </div>
    </Card>
  );
}

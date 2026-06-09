import { useState } from 'react';
import { Icon, SeedMark } from '@/ui/icons';
import { Eyebrow, Button, Checkbox } from '@/ui/controls';
import { Field, TextInput } from '@/ui/fields';
import { authApi } from '@/api/auth';
import { toApiError } from '@/api/client';
import type { Lang, TFunc } from '@/i18n';
import type { AccountUser } from '@/types/account';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Left editorial brand panel shared by the pre-auth screens. */
function BrandPanel({ t, lang }: { t: TFunc; lang: Lang }) {
  return (
    <div className="auth-aside">
      <div className="auth-aside-top">
        <div className="lockup">
          <SeedMark size={30} color="#c7d6ee" />
          <span className="lockup-word">{t('brand')}</span>
        </div>
      </div>

      <div className="auth-aside-body">
        <Eyebrow style={{ color: 'var(--amber)' }}>{t('brand_sub')}</Eyebrow>
        <h1 className="auth-quote serif">
          {lang === 'vi'
            ? 'Mỗi ca làm trơn tru bắt đầu từ một lần đăng nhập gọn gàng.'
            : 'Every smooth shift begins with one calm sign-in.'}
        </h1>
        <p className="auth-quote-sub">
          {lang === 'vi'
            ? 'Bảng điều phối AGV, trạng thái đội xe và nhật ký vận hành — tất cả trong một không gian ấm áp, rõ ràng.'
            : 'AGV dispatch, fleet status and the operations log — all in one warm, legible workspace.'}
        </p>
      </div>

      <div className="auth-aside-foot">
        <div className="auth-stat">
          <span className="auth-stat-n serif">142</span>
          <span className="auth-stat-l">{lang === 'vi' ? 'AGV trực tuyến' : 'AGV online'}</span>
        </div>
        <div className="auth-stat">
          <span className="auth-stat-n serif">99.2%</span>
          <span className="auth-stat-l">{lang === 'vi' ? 'Thời gian hoạt động' : 'Uptime'}</span>
        </div>
        <div className="auth-stat">
          <span className="auth-stat-n serif">3</span>
          <span className="auth-stat-l">{lang === 'vi' ? 'Ca / ngày' : 'Shifts / day'}</span>
        </div>
      </div>
    </div>
  );
}

/** UC-81 — Login. */
export function LoginView({
  t,
  lang,
  onLogin,
  onForgot,
}: {
  t: TFunc;
  lang: Lang;
  onLogin: (user: AccountUser) => void;
  onForgot: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!username.trim() || !password) {
      setErr(t('err_login'));
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const user = await authApi.login(username.trim(), password);
      onLogin(user);
    } catch (ex) {
      setErr(toApiError(ex) || t('err_login'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <BrandPanel t={t} lang={lang} />
      <div className="auth-main">
        <form className="auth-form" onSubmit={submit}>
          <Eyebrow>{t('login_eyebrow')}</Eyebrow>
          <h2 className="auth-title serif">{t('login_title')}</h2>
          <p className="auth-lede">{t('login_lede')}</p>

          {err && (
            <div className="auth-alert">
              <Icon name="x" size={15} stroke={2.4} />
              {err}
            </div>
          )}

          <div style={{ marginTop: 26, display: 'grid', gap: 18 }}>
            <Field label={t('username')} htmlFor="u">
              <TextInput id="u" value={username} onChange={setUsername} placeholder={t('username_ph')} icon="user" autoFocus />
            </Field>
            <Field label={t('password')} htmlFor="p" hint={t('hint_demo')}>
              <TextInput id="p" value={password} onChange={setPassword} placeholder={t('password_ph')} icon="lock" type="password" />
            </Field>
          </div>

          <div className="auth-row">
            <Checkbox id="rem" checked={remember} onChange={setRemember} label={t('remember')} />
            <button type="button" className="link" onClick={onForgot}>
              {t('forgot_link')}
            </button>
          </div>

          <Button type="submit" full disabled={loading} iconRight={loading ? null : 'arrow'} style={{ marginTop: 24 }}>
            {loading ? t('signing_in') : t('sign_in')}
          </Button>

          <p className="auth-help">{t('login_help')}</p>
        </form>
      </div>
    </div>
  );
}

/** UC-86 — Forgot password. */
export function ForgotView({ t, lang, onBack }: { t: TFunc; lang: Lang; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setErr(t('err_email'));
      return;
    }
    setErr('');
    try {
      await authApi.forgotPassword(email);
    } catch {
      /* always show the generic success state to avoid account enumeration */
    }
    setSent(true);
  }

  return (
    <div className="auth-shell">
      <BrandPanel t={t} lang={lang} />
      <div className="auth-main">
        <form className="auth-form" onSubmit={submit}>
          {!sent ? (
            <>
              <Eyebrow>{t('forgot_eyebrow')}</Eyebrow>
              <h2 className="auth-title serif">{t('forgot_title')}</h2>
              <p className="auth-lede">{t('forgot_lede')}</p>

              {err && (
                <div className="auth-alert">
                  <Icon name="x" size={15} stroke={2.4} />
                  {err}
                </div>
              )}

              <div style={{ marginTop: 26 }}>
                <Field label={t('email')} htmlFor="e">
                  <TextInput id="e" value={email} onChange={setEmail} placeholder={t('email_ph')} icon="mail" type="email" autoFocus />
                </Field>
              </div>

              <Button type="submit" full iconRight="arrow" style={{ marginTop: 24 }}>
                {t('send_link')}
              </Button>
              <button type="button" className="link auth-back" onClick={onBack}>
                <Icon name="chevright" size={15} style={{ transform: 'scaleX(-1)' }} />
                {t('back_login')}
              </button>
            </>
          ) : (
            <div className="auth-success">
              <div className="auth-success-mark">
                <Icon name="mail" size={30} />
              </div>
              <h2 className="auth-title serif" style={{ marginTop: 18 }}>
                {t('forgot_done_t')}
              </h2>
              <p className="auth-lede">{t('forgot_done_b')}</p>
              <div className="auth-sent-to">{email}</div>
              <Button variant="secondary" full onClick={() => setSent(false)} style={{ marginTop: 22 }}>
                {t('resend')}
              </Button>
              <button type="button" className="link auth-back" onClick={onBack}>
                <Icon name="chevright" size={15} style={{ transform: 'scaleX(-1)' }} />
                {t('back_login')}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

/** UC-86 — Reset password from email token. */
export function ResetPasswordView({
  t,
  lang,
  token,
  onBack,
}: {
  t: TFunc;
  lang: Lang;
  token: string;
  onBack: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(token ? '' : t('err_reset_token'));
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!token) {
      setErr(t('err_reset_token'));
      return;
    }
    if (password.length < 8) {
      setErr(t('err_password_short'));
      return;
    }
    if (password !== confirm) {
      setErr(t('err_password_match'));
      return;
    }

    setErr('');
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (ex) {
      setErr(toApiError(ex));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <BrandPanel t={t} lang={lang} />
      <div className="auth-main">
        <form className="auth-form" onSubmit={submit}>
          {!done ? (
            <>
              <Eyebrow>{t('reset_eyebrow')}</Eyebrow>
              <h2 className="auth-title serif">{t('reset_title')}</h2>
              <p className="auth-lede">{t('reset_lede')}</p>

              {err && (
                <div className="auth-alert">
                  <Icon name="x" size={15} stroke={2.4} />
                  {err}
                </div>
              )}

              <div style={{ marginTop: 26, display: 'grid', gap: 18 }}>
                <Field label={t('reset_new_password')} htmlFor="np">
                  <TextInput id="np" value={password} onChange={setPassword} placeholder={t('reset_new_password')} icon="lock" type="password" autoFocus />
                </Field>
                <Field label={t('reset_confirm_password')} htmlFor="cp">
                  <TextInput id="cp" value={confirm} onChange={setConfirm} placeholder={t('reset_confirm_password')} icon="lock" type="password" />
                </Field>
              </div>

              <Button type="submit" full disabled={loading || !token} iconRight={loading ? null : 'arrow'} style={{ marginTop: 24 }}>
                {loading ? t('signing_in') : t('reset_password_btn')}
              </Button>
              <button type="button" className="link auth-back" onClick={onBack}>
                <Icon name="chevright" size={15} style={{ transform: 'scaleX(-1)' }} />
                {t('back_login')}
              </button>
            </>
          ) : (
            <div className="auth-success">
              <div className="auth-success-mark">
                <Icon name="check" size={30} />
              </div>
              <h2 className="auth-title serif" style={{ marginTop: 18 }}>
                {t('reset_done_t')}
              </h2>
              <p className="auth-lede">{t('reset_done_b')}</p>
              <Button full iconRight="arrow" onClick={onBack} style={{ marginTop: 22 }}>
                {t('back_login')}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

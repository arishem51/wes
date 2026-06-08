import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { Icon } from '@/ui/icons';
import { Button } from '@/ui/controls';
import { Modal } from '@/ui/overlay';
import { useToast } from '@/ui/toast';
import { LoginView, ForgotView } from '@/features/auth/AuthScreens';
import { AppShell, type View } from '@/components/AppShell';
import type { AccountTab } from '@/features/account/AccountArea';
import { authApi } from '@/api/auth';
import { accountApi } from '@/api/account';
import type { AccountUser, Prefs } from '@/types/account';

type Route = 'login' | 'forgot' | 'app';

// Placeholder until the real profile arrives via login() or getProfile().
const EMPTY_USER: AccountUser = {
  name: '',
  username: '',
  email: '',
  phone: '',
  shift: '',
  role: 'operator',
  photo: null,
  created: new Date().toISOString(),
};

export default function App() {
  const { lang, setLang, t } = useI18n();
  const { toast } = useToast();

  const [route, setRoute] = useState<Route>(() => (authApi.isAuthenticated() ? 'app' : 'login'));
  const [user, setUser] = useState<AccountUser>(EMPTY_USER);
  const [view, setView] = useState<View>('users');
  const [accountTab, setAccountTab] = useState<AccountTab>('profile');
  const [confirmOut, setConfirmOut] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ notif: true, sound: false });

  // Load the signed-in profile when entering the app.
  useEffect(() => {
    if (route !== 'app') return;
    accountApi.getProfile().then(setUser).catch(() => undefined);
  }, [route]);

  function doLogin(loggedIn: AccountUser) {
    setUser(loggedIn);
    setView('users');
    setRoute('app');
  }

  async function doSignout() {
    setConfirmOut(false);
    await authApi.logout();
    setRoute('login');
  }

  return (
    <div style={{ minHeight: '100vh', background: route === 'app' ? 'var(--app-bg)' : 'var(--ink)' }}>
      {route === 'login' && <LoginView t={t} lang={lang} onLogin={doLogin} onForgot={() => setRoute('forgot')} />}
      {route === 'forgot' && <ForgotView t={t} lang={lang} onBack={() => setRoute('login')} />}
      {route === 'app' && (
        <AppShell
          user={user}
          setUser={setUser}
          lang={lang}
          setLang={setLang}
          t={t}
          onSignout={() => setConfirmOut(true)}
          view={view}
          setView={setView}
          accountTab={accountTab}
          setAccountTab={setAccountTab}
          toast={toast}
          twoFA={twoFA}
          setTwoFA={setTwoFA}
          prefs={prefs}
          setPrefs={setPrefs}
        />
      )}

      <Modal open={confirmOut} onClose={() => setConfirmOut(false)} width={420}>
        <div className="confirm">
          <div className="confirm-mark">
            <Icon name="logout" size={24} />
          </div>
          <h2 className="confirm-title serif">{t('logout_title')}</h2>
          <p className="confirm-body">{t('logout_body')}</p>
          <div className="confirm-actions">
            <Button variant="secondary" full onClick={() => setConfirmOut(false)}>
              {t('cancel')}
            </Button>
            <Button full icon="logout" onClick={doSignout}>
              {t('logout_confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

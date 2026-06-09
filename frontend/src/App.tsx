import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Icon } from '@/ui/icons';
import { Button } from '@/ui/controls';
import { Modal } from '@/ui/overlay';
import { useToast } from '@/ui/toast';
import { LoginView, ForgotView, ResetPasswordView } from '@/features/auth/AuthScreens';
import { AppShell, type View } from '@/components/AppShell';
import type { AccountTab } from '@/features/account/AccountArea';
import { authApi } from '@/api/auth';
import { accountApi } from '@/api/account';
import type { AccountUser, Prefs } from '@/types/account';

const accountPath = (tab: AccountTab): string => {
  if (tab === 'security') return '/account/security';
  if (tab === 'prefs') return '/account/preferences';
  return '/account';
};

const accountTabFromPath = (path: string): AccountTab => {
  if (path.startsWith('/account/security')) return 'security';
  if (path.startsWith('/account/preferences')) return 'prefs';
  return 'profile';
};

function LoadingScreen() {
  return <div style={{ minHeight: '100vh', background: 'var(--app-bg)' }} />;
}

function AppRoutes() {
  const { lang, setLang, t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ notif: true, sound: false });

  async function doSignout() {
    setConfirmOut(false);
    await authApi.logout();
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={
            <LoginRoute
              t={t}
              lang={lang}
              onLogin={(loggedIn) => {
                setUser(loggedIn);
                navigate(loggedIn.role === 'admin' ? '/admin/users' : '/account', { replace: true });
              }}
            />
          }
        />
        <Route
          path="/forgot-password"
          element={
            <div style={{ minHeight: '100vh', background: 'var(--ink)' }}>
              <ForgotView t={t} lang={lang} onBack={() => navigate('/login')} />
            </div>
          }
        />
        <Route path="/reset-password" element={<ResetRoute t={t} lang={lang} onBack={() => navigate('/login', { replace: true })} />} />
        <Route
          path="/account/*"
          element={
            <AuthenticatedApp
              user={user}
              setUser={setUser}
              lang={lang}
              setLang={setLang}
              t={t}
              toast={toast}
              onSignout={() => setConfirmOut(true)}
              prefs={prefs}
              setPrefs={setPrefs}
            />
          }
        />
        <Route
          path="/admin/users"
          element={
            <AuthenticatedApp
              user={user}
              setUser={setUser}
              lang={lang}
              setLang={setLang}
              t={t}
              toast={toast}
              onSignout={() => setConfirmOut(true)}
              prefs={prefs}
              setPrefs={setPrefs}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>

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

function LoginRoute({
  t,
  lang,
  onLogin,
}: {
  t: ReturnType<typeof useI18n>['t'];
  lang: ReturnType<typeof useI18n>['lang'];
  onLogin: (user: AccountUser) => void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    authApi.clearSession();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)' }}>
      <LoginView t={t} lang={lang} onLogin={onLogin} onForgot={() => navigate('/forgot-password')} />
    </div>
  );
}

function ResetRoute({
  t,
  lang,
  onBack,
}: {
  t: ReturnType<typeof useI18n>['t'];
  lang: ReturnType<typeof useI18n>['lang'];
  onBack: () => void;
}) {
  const [params] = useSearchParams();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)' }}>
      <ResetPasswordView t={t} lang={lang} token={params.get('token') ?? ''} onBack={onBack} />
    </div>
  );
}

function AuthenticatedApp({
  user,
  setUser,
  lang,
  setLang,
  t,
  toast,
  onSignout,
  prefs,
  setPrefs,
}: {
  user: AccountUser | null;
  setUser: (user: AccountUser | null) => void;
  lang: ReturnType<typeof useI18n>['lang'];
  setLang: ReturnType<typeof useI18n>['setLang'];
  t: ReturnType<typeof useI18n>['t'];
  toast: (s: string) => void;
  onSignout: () => void;
  prefs: Prefs;
  setPrefs: (updater: (p: Prefs) => Prefs) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(!user);

  useEffect(() => {
    if (!authApi.isAuthenticated()) {
      authApi.clearSession();
      setUser(null);
      navigate('/login', { replace: true });
      return;
    }

    if (user) {
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    accountApi.getProfile().then((profile) => {
      if (!alive) return;
      setUser(profile);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      authApi.clearSession();
      setUser(null);
      navigate('/login', { replace: true });
    });

    return () => {
      alive = false;
    };
  }, [navigate, setUser, user]);

  useEffect(() => {
    if (user?.role !== 'admin' && location.pathname === '/admin/users') {
      navigate('/account', { replace: true });
    }
  }, [location.pathname, navigate, user?.role]);

  if (loading || !user) return <LoadingScreen />;

  const view: View = location.pathname === '/admin/users' && user.role === 'admin' ? 'users' : 'account';
  const accountTab = accountTabFromPath(location.pathname);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--app-bg)' }}>
      <AppShell
        user={user}
        setUser={(next) => setUser(next)}
        lang={lang}
        setLang={setLang}
        t={t}
        onSignout={onSignout}
        view={view}
        setView={(next) => navigate(next === 'users' ? '/admin/users' : '/account')}
        accountTab={accountTab}
        setAccountTab={(tab) => navigate(accountPath(tab))}
        toast={toast}
        prefs={prefs}
        setPrefs={setPrefs}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

import { useState } from 'react';
import { Icon, SeedMark } from '@/ui/icons';
import { Avatar } from '@/ui/display';
import { AccountArea, type AccountTab } from '@/features/account/AccountArea';
import { UsersAdmin } from '@/features/usersAdmin/UsersAdmin';
import type { Lang, TFunc } from '@/i18n';
import type { AccountUser, Prefs } from '@/types/account';

export type View = 'users' | 'account';

const NAV = [
  {
    section: { vi: 'Vận hành', en: 'Operations' },
    items: [
      { id: 'dashboard', icon: 'gauge', label: { vi: 'Bảng điều khiển', en: 'Dashboard' } },
      { id: 'requests', icon: 'truck', label: { vi: 'Yêu cầu vận chuyển', en: 'Transport requests' } },
      { id: 'fleet', icon: 'grid', label: { vi: 'Đội AGV', en: 'AGV fleet' } },
    ],
  },
  {
    section: { vi: 'Quản trị', en: 'Administration' },
    items: [{ id: 'users', icon: 'users', label: { vi: 'Người dùng & Quyền', en: 'Users & Access' } }],
  },
];

function Sidebar({ t, lang, user, view, onUsers }: { t: TFunc; lang: Lang; user: AccountUser; view: View; onUsers: () => void }) {
  const canManageUsers = user.role === 'admin';

  return (
    <aside className="side">
      <div className="side-brand">
        <div className="side-logo">
          <SeedMark size={26} color="#fff" />
        </div>
        <div>
          <div className="side-brand-name">{t('brand')}</div>
          <div className="side-brand-sub">{t('brand_sub')}</div>
        </div>
      </div>
      <nav className="side-nav">
        {NAV.filter((grp) => canManageUsers || grp.section.en !== 'Administration').map((grp, gi) => (
          <div key={gi} className="side-group">
            <div className="side-section">{grp.section[lang]}</div>
            {grp.items.map((it) => {
              const active = it.id === 'users' && view === 'users';
              return (
                <div key={it.id} className={'side-item' + (active ? ' active' : '')} onClick={it.id === 'users' && canManageUsers ? onUsers : undefined}>
                  <Icon name={it.icon} size={18} />
                  <span style={{ flex: 1 }}>{it.label[lang]}</span>
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <Avatar name={user.name} src={user.photo} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="side-foot-name">{user.name}</div>
          <div className="side-foot-role">{user.role === 'admin' ? t('role_admin') : t('role_operator')}</div>
        </div>
      </div>
    </aside>
  );
}

/** Topbar username popup — entry to the basic-user self-service area (UC-82/83/85). */
function UserMenu({ user, t, onGoAccount, onSignout }: { user: AccountUser; t: TFunc; onGoAccount: (tab: AccountTab) => void; onSignout: () => void }) {
  const [open, setOpen] = useState(false);
  const roleLabel = user.role === 'admin' ? t('role_admin') : t('role_operator');
  return (
    <div className="usermenu">
      <button className="usermenu-trigger" onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.name} src={user.photo} size={34} />
        <span className="usermenu-name">{user.name}</span>
        <Icon name="chevdown" size={16} style={{ color: 'var(--ink-3)' }} />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-pop">
            <div className="menu-head">
              <Avatar name={user.name} src={user.photo} size={40} />
              <div style={{ minWidth: 0 }}>
                <div className="menu-head-name">{user.name}</div>
                <div className="menu-head-sub">
                  {roleLabel} · @{user.username}
                </div>
              </div>
            </div>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { setOpen(false); onGoAccount('profile'); }}>
              <Icon name="user" size={18} />
              {t('menu_profile')}
            </button>
            <button className="menu-item" onClick={() => { setOpen(false); onGoAccount('security'); }}>
              <Icon name="shield" size={18} />
              {t('menu_security')}
            </button>
            <div className="menu-sep" />
            <button className="menu-item danger" onClick={() => { setOpen(false); onSignout(); }}>
              <Icon name="logout" size={18} />
              {t('menu_signout')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AppShell({
  user,
  setUser,
  lang,
  setLang,
  t,
  onSignout,
  view,
  setView,
  accountTab,
  setAccountTab,
  toast,
  twoFA,
  setTwoFA,
  prefs,
  setPrefs,
}: {
  user: AccountUser;
  setUser: (u: AccountUser) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
  onSignout: () => void;
  view: View;
  setView: (v: View) => void;
  accountTab: AccountTab;
  setAccountTab: (tab: AccountTab) => void;
  toast: (s: string) => void;
  twoFA: boolean;
  setTwoFA: (v: boolean) => void;
  prefs: Prefs;
  setPrefs: (updater: (p: Prefs) => Prefs) => void;
}) {
  const canManageUsers = user.role === 'admin';
  const effectiveView: View = canManageUsers ? view : 'account';
  const crumbSection = effectiveView === 'users' ? t('um_eyebrow') : t('nav_account');
  const crumbCurrent = effectiveView === 'users' ? t('um_nav') : t('acct_title');
  return (
    <div className="app-frame">
      <div className="app-card">
        <Sidebar t={t} lang={lang} user={user} view={effectiveView} onUsers={() => setView('users')} />
        <div className="app-col">
          <header className="topbar">
            <div className="crumbs">
              <span>{crumbSection}</span>
              <Icon name="chevright" size={14} style={{ color: 'var(--ink-3)' }} />
              <span className="crumb-cur">{crumbCurrent}</span>
            </div>
            <div className="topbar-right">
              <button className="icon-btn">
                <Icon name="bell" size={19} />
                <span className="bell-dot" />
              </button>
              <UserMenu
                user={user}
                t={t}
                onGoAccount={(tab) => {
                  setAccountTab(tab);
                  setView('account');
                }}
                onSignout={onSignout}
              />
            </div>
          </header>

          {effectiveView === 'users' ? (
            <UsersAdmin t={t} lang={lang} />
          ) : (
            <AccountArea
              user={user}
              setUser={setUser}
              lang={lang}
              setLang={setLang}
              t={t}
              toast={toast}
              twoFA={twoFA}
              setTwoFA={setTwoFA}
              prefs={prefs}
              setPrefs={setPrefs}
              tab={accountTab}
              setTab={setAccountTab}
            />
          )}
        </div>
      </div>
    </div>
  );
}

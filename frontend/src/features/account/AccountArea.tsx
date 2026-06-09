import { Eyebrow } from '@/ui/controls';
import { ProfilePanel, SecurityPanel, PreferencesPanel } from './AccountPanels';
import type { Lang, TFunc } from '@/i18n';
import type { AccountUser, Prefs } from '@/types/account';

export type AccountTab = 'profile' | 'security' | 'prefs';

export function AccountArea({
  user,
  setUser,
  lang,
  setLang,
  t,
  toast,
  prefs,
  setPrefs,
  tab,
  setTab,
}: {
  user: AccountUser;
  setUser: (u: AccountUser) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
  toast: (s: string) => void;
  prefs: Prefs;
  setPrefs: (updater: (p: Prefs) => Prefs) => void;
  tab: AccountTab;
  setTab: (tab: AccountTab) => void;
}) {
  const tabs: { id: AccountTab; label: string }[] = [
    { id: 'profile', label: t('tab_profile') },
    { id: 'security', label: t('tab_security') },
    { id: 'prefs', label: t('tab_prefs') },
  ];
  return (
    <main className="page-scroll">
      <div className="page-inner">
        <div className="page-head">
          <Eyebrow>{t('nav_account')}</Eyebrow>
          <h1 className="page-title serif">{t('acct_title')}</h1>
          <p className="page-lede">{t('acct_lede')}</p>
        </div>
        <div className="tabbar">
          {tabs.map((tb) => (
            <button key={tb.id} className={'tab' + (tab === tb.id ? ' active' : '')} onClick={() => setTab(tb.id)}>
              {tb.label}
            </button>
          ))}
        </div>
        <div className="tab-body">
          {tab === 'profile' && <ProfilePanel user={user} setUser={setUser} lang={lang} t={t} toast={toast} />}
          {tab === 'security' && <SecurityPanel t={t} toast={toast} />}
          {tab === 'prefs' && <PreferencesPanel t={t} lang={lang} setLang={setLang} prefs={prefs} setPrefs={setPrefs} toast={toast} />}
        </div>
      </div>
    </main>
  );
}

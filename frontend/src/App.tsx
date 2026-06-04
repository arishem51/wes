import { useI18n } from '@/i18n';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { UsersScreen } from '@/features/users/UsersScreen';

export default function App() {
  const { lang, setLang, t } = useI18n('vi');

  return (
    <div style={{ height: '100vh', padding: 22, background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div
        style={{
          height: '100%',
          display: 'flex',
          background: 'var(--surface)',
          borderRadius: 18,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        <Sidebar t={t} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar t={t} lang={lang} setLang={setLang} />
          <UsersScreen t={t} lang={lang} />
        </div>
      </div>
    </div>
  );
}

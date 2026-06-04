import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '@/lib/icons';

interface ToastAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}
interface ToastOpts {
  desc?: string;
  tone?: 'success' | 'danger';
  actions?: ToastAction[];
}
interface Toast extends ToastOpts {
  id: string;
  title: string;
}

interface ToastCtx {
  toast: (title: string, opts?: ToastOpts) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const toast = useCallback((title: string, opts: ToastOpts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, title, ...opts }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), opts.actions ? 6500 : 3200);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <ToastStack toasts={toasts} dismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: 'center',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '11px 14px 11px 13px',
            background: 'var(--toast-bg)',
            color: 'var(--toast-fg)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-xl)',
            animation: 'toastIn .22s cubic-bezier(.2,.8,.3,1)',
            minWidth: 280,
            maxWidth: 440,
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: t.tone === 'danger' ? 'var(--danger)' : 'var(--success)',
              color: '#fff',
            }}
          >
            <Icon name={t.tone === 'danger' ? 'trash' : 'check'} size={13} />
          </span>
          <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>
            {t.title}
            {t.desc && <div style={{ fontSize: 12.5, fontWeight: 400, opacity: 0.7, marginTop: 1 }}>{t.desc}</div>}
          </div>
          {t.actions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {t.actions.map((a, i) => (
                <button
                  key={i}
                  onClick={() => {
                    a.onClick && a.onClick();
                    dismiss(t.id);
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: a.primary ? 'var(--toast-action)' : 'rgba(255,255,255,.78)',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 7px',
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

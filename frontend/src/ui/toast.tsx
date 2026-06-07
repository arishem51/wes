import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

interface Toast {
  id: string;
  title: string;
}
interface ToastCtx {
  toast: (title: string) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((title: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { id, title }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack">
        {toasts.map((tt) => (
          <div key={tt.id} className="toast">
            <span className="toast-icon">
              <Icon name="check" size={14} stroke={3} />
            </span>
            <span>{tt.title}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function Modal({
  open,
  onClose,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

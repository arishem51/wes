import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '@/lib/icons';
import { IconButton } from './controls';

export interface MenuItemDef {
  label?: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: ReactNode;
  items: MenuItemDef[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align]: 0,
            zIndex: 40,
            minWidth: 196,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
            animation: 'popIn .12s ease',
          }}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            ) : (
              <button
                key={i}
                onClick={() => {
                  setOpen(false);
                  it.onClick && it.onClick();
                }}
                disabled={it.disabled}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: it.disabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  background: 'transparent',
                  color: it.danger ? 'var(--danger)' : 'var(--text)',
                  opacity: it.disabled ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!it.disabled)
                    e.currentTarget.style.background = it.danger ? 'var(--danger-tint)' : 'var(--subtle)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {it.icon && (
                  <Icon name={it.icon} size={16} style={{ color: it.danger ? 'var(--danger)' : 'var(--text-muted)' }} />
                )}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

type IconTone = 'accent' | 'danger' | 'warn';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  iconTone = 'accent',
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  icon?: string;
  iconTone?: IconTone;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const tone = {
    accent: { bg: 'var(--accent-tint)', fg: 'var(--accent)' },
    danger: { bg: 'var(--danger-tint)', fg: 'var(--danger)' },
    warn: { bg: 'var(--warn-tint)', fg: 'var(--warn-fg)' },
  }[iconTone];
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(17,20,28,.42)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '7vh 20px 20px',
        overflowY: 'auto',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '100%',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          animation: 'modalIn .16s cubic-bezier(.2,.8,.3,1)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 22px 0' }}>
          {icon && (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: tone.bg,
                color: tone.fg,
              }}
            >
              <Icon name={icon} size={20} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--text)', letterSpacing: '-.01em' }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {subtitle}
              </p>
            )}
          </div>
          <IconButton name="close" onClick={onClose} label="Close" />
        </div>
        <div style={{ padding: '18px 22px' }}>{children}</div>
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              padding: '14px 22px',
              borderTop: '1px solid var(--border)',
              background: 'var(--subtle-soft)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(17,20,28,.34)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '100%',
          height: '100%',
          background: 'var(--bg)',
          boxShadow: 'var(--shadow-xl)',
          animation: 'drawerIn .2s cubic-bezier(.2,.8,.3,1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

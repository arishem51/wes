import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/lib/icons';

type ButtonVariant =
  | 'primary'
  | 'dark'
  | 'default'
  | 'ghost'
  | 'subtle'
  | 'danger'
  | 'danger-ghost';

interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: string;
  iconRight?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
  style?: CSSProperties;
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  icon,
  iconRight,
  onClick,
  disabled,
  type = 'button',
  full,
  style = {},
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'inherit',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent',
    borderRadius: 'var(--radius)',
    whiteSpace: 'nowrap',
    transition: 'background .14s, border-color .14s, color .14s, box-shadow .14s',
    width: full ? '100%' : 'auto',
    opacity: disabled ? 0.5 : 1,
    fontSize: size === 'sm' ? 13 : 14,
    padding: size === 'sm' ? '5px 10px' : '8px 14px',
    ...style,
  };
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.08)' },
    dark: { background: 'var(--btn-dark)', color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.18)' },
    default: { background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
    ghost: { background: 'transparent', color: 'var(--text-muted)' },
    subtle: { background: 'var(--subtle)', color: 'var(--text)' },
    danger: { background: 'var(--danger)', color: '#fff' },
    'danger-ghost': { background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger-border)' },
  };
  const hoverStyles: Record<ButtonVariant, CSSProperties> = {
    primary: { filter: 'brightness(1.06)' },
    dark: { background: 'var(--btn-dark-hover)' },
    default: { borderColor: 'var(--border-strong)', background: 'var(--subtle)' },
    ghost: { background: 'var(--subtle)', color: 'var(--text)' },
    subtle: { background: 'var(--subtle-strong)' },
    danger: { filter: 'brightness(1.06)' },
    'danger-ghost': { background: 'var(--danger-tint)' },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variants[variant], ...(hover && !disabled ? hoverStyles[variant] : {}) }}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 15 : 16} />}
    </button>
  );
}

interface IconButtonProps {
  name: string;
  onClick?: () => void;
  label?: string;
  active?: boolean;
  size?: number;
  danger?: boolean;
}

export function IconButton({ name, onClick, label, active, size = 18, danger }: IconButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        border: '1px solid transparent',
        color: danger ? 'var(--danger)' : active ? 'var(--accent)' : 'var(--text-muted)',
        background: hover
          ? danger
            ? 'var(--danger-tint)'
            : 'var(--subtle)'
          : active
            ? 'var(--accent-tint)'
            : 'transparent',
        transition: 'background .14s, color .14s',
      }}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

interface SegOption {
  value: string;
  label?: string;
  icon?: string;
}
export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SegOption[];
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--subtle)',
        borderRadius: 'var(--radius-sm)',
        padding: 3,
        gap: 2,
        border: '1px solid var(--border)',
      }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              cursor: 'pointer',
              padding: o.label ? '5px 11px' : '5px 8px',
              borderRadius: 'calc(var(--radius-sm) - 2px)',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              color: active ? 'var(--text)' : 'var(--text-muted)',
              background: active ? 'var(--surface)' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              transition: 'all .12s',
            }}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        width: 40,
        height: 23,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        padding: 2,
        background: checked ? 'var(--accent)' : 'var(--border-strong)',
        transition: 'background .16s',
        display: 'flex',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        alignItems: 'center',
      }}
    >
      <span
        style={{
          width: 19,
          height: 19,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.25)',
          transition: 'all .16s',
        }}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        cursor: 'pointer',
        flexShrink: 0,
        border: `1.5px solid ${checked || indeterminate ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: checked || indeterminate ? 'var(--accent)' : 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        transition: 'background .12s, border-color .12s',
      }}
    >
      {checked && <Icon name="check" size={13} />}
      {indeterminate && !checked && <span style={{ width: 9, height: 2, background: '#fff', borderRadius: 1 }} />}
    </button>
  );
}

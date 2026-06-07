import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './icons';

export function Eyebrow({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: CSSProperties }) {
  return (
    <div className={'eyebrow' + (muted ? ' muted' : '')} style={style}>
      {children}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'ghost';

export function Button({
  children,
  variant = 'primary',
  icon,
  iconRight,
  onClick,
  type = 'button',
  disabled,
  full,
  size = 'md',
  style = {},
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  icon?: string;
  iconRight?: string | null;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  full?: boolean;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}) {
  const cls =
    variant === 'primary'
      ? 'btn btn-primary'
      : variant === 'secondary'
        ? 'btn btn-secondary'
        : variant === 'text'
          ? 'btn-text'
          : 'btn btn-ghost';
  const sizeStyle: CSSProperties =
    size === 'sm' ? { height: 42, fontSize: 14.5, padding: '0 16px', borderRadius: 12 } : {};
  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: full ? '100%' : undefined,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...sizeStyle,
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 17 : 18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 17 : 18} />}
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  id?: string;
}) {
  return (
    <label className="checkbox" htmlFor={id}>
      <button
        type="button"
        id={id}
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={'checkbox-box' + (checked ? ' checked' : '')}
      >
        {checked && <Icon name="check" size={13} stroke={3} />}
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={'toggle' + (checked ? ' on' : '')}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={'seg-btn' + (value === o.value ? ' active' : '')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label?: string;
  error?: string | null | false;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  icon,
  error,
  onBlur,
  autoFocus,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  icon?: string;
  error?: string | null | false;
  onBlur?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === 'password';
  const realType = isPw ? (show ? 'text' : 'password') : type;
  return (
    <div className={'input-wrap' + (error ? ' has-error' : '') + (disabled ? ' is-disabled' : '')}>
      {icon && (
        <span className="input-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <input
        id={id}
        type={realType}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{ paddingLeft: icon ? 44 : 16, paddingRight: isPw ? 64 : 16 }}
      />
      {isPw && (
        <button type="button" className="input-trailing" onClick={() => setShow((s) => !s)} tabIndex={-1}>
          <Icon name={show ? 'eyeoff' : 'eye'} size={18} />
        </button>
      )}
    </div>
  );
}

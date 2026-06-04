import { useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import { Icon } from '@/lib/icons';

export function Field({
  label,
  error,
  children,
  hint,
  required,
}: {
  label: string;
  error?: string | number | boolean | null;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
      {error ? (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--danger)', marginTop: 5 }}>{error}</span>
      ) : hint ? (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>{hint}</span>
      ) : null}
    </label>
  );
}

interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: string | number | boolean | null;
  prefixIcon?: string;
  mono?: boolean;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
  prefixIcon,
  mono,
  onBlur,
  autoFocus,
}: TextInputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {prefixIcon && (
        <Icon name={prefixIcon} size={16} style={{ position: 'absolute', left: 11, color: 'var(--text-muted)' }} />
      )}
      <input
        value={value}
        type={type}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={(e) => {
          setFocus(false);
          onBlur && onBlur(e);
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: mono ? 'var(--mono)' : 'inherit',
          fontSize: 14,
          padding: prefixIcon ? '9px 12px 9px 34px' : '9px 12px',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text)',
          background: 'var(--surface)',
          border: `1px solid ${error ? 'var(--danger)' : focus ? 'var(--accent)' : 'var(--border)'}`,
          boxShadow: focus ? `0 0 0 3px ${error ? 'var(--danger-tint)' : 'var(--accent-ring)'}` : 'none',
          outline: 'none',
          transition: 'border-color .14s, box-shadow .14s',
        }}
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: '100%',
          appearance: 'none',
          fontFamily: 'inherit',
          fontSize: 14,
          padding: '9px 34px 9px 12px',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text)',
          background: 'var(--surface)',
          cursor: 'pointer',
          border: `1px solid ${focus ? 'var(--accent)' : 'var(--border)'}`,
          boxShadow: focus ? '0 0 0 3px var(--accent-ring)' : 'none',
          outline: 'none',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevdown"
        size={16}
        style={{
          position: 'absolute',
          right: 11,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

import type { CSSProperties, ReactNode } from 'react';

export function Avatar({
  name,
  src,
  size = 44,
  ring,
}: {
  name: string;
  src?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        boxShadow: ring ? '0 0 0 3px var(--paper), 0 0 0 5px var(--accent-soft)' : undefined,
      }}
    >
      {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </div>
  );
}

export function Card({ children, style, pad = 26 }: { children: ReactNode; style?: CSSProperties; pad?: number }) {
  return (
    <div className="ll-card" style={{ padding: pad, ...style }}>
      {children}
    </div>
  );
}

export function SectionHead({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h3 className="section-title">{title}</h3>
        {desc && <p className="section-desc">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

import type { CSSProperties } from 'react';

/** Brand seed glyph used in the auth panel and sidebar logo. */
export function SeedMark({ size = 30, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <svg width={size * 0.86} height={size} viewBox="0 0 26 30" fill="none" aria-hidden="true">
      <path d="M13 1C7 6 4 11 4 17c0 6.6 4 11 9 11s9-4.4 9-11c0-6-3-11-9-16z" fill={color} opacity="0.16" />
      <path d="M13 1C7 6 4 11 4 17c0 6.6 4 11 9 11s9-4.4 9-11c0-6-3-11-9-16z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 8c-2.4 2.2-3.6 4.8-3.6 8.2 0 3.4 1.4 6 3.6 7.3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const PATHS: Record<string, string> = {
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8z M4.5 20a7.5 7.5 0 0115 0',
  lock: 'M5 11h14v9H5z M8 11V7a4 4 0 018 0v4',
  mail: 'M3 5.5h18v13H3z M3 6.5l9 6.5 9-6.5',
  phone: 'M5 4h4l2 5-2.5 1.6a13 13 0 006 6L17 14l5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3a14 14 0 000 18 M12 3a14 14 0 010 18',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeoff:
    'M3 3l18 18 M10.6 6.2A9.7 9.7 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3.3 3.9 M6.2 7.4A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 003.6-.7 M9.9 9.9a3 3 0 004.2 4.2',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  chevdown: 'M6 9l6 6 6-6',
  chevright: 'M9 6l6 6-6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z M14 5l4 4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3.5 2',
  bell: 'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6 M10 21h4',
  laptop: 'M5 5h14v10H5z M3 19h18 M9 19l.5-2h5l.5 2',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  gauge: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 12l4-3',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  truck: 'M3 7h11v8H3z M14 10h4l3 3v2h-7 M7 19a2 2 0 100-4 2 2 0 000 4z M18 19a2 2 0 100-4 2 2 0 000 4z',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8z M2 21a7 7 0 0114 0 M17 11a4 4 0 000-8 M22 21a7 7 0 00-5-6.7',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  key: 'M14 8a4 4 0 11-5.7 3.6L3 17v3h3l1-1h2v-2h2l1.3-1.3A4 4 0 0014 8z M15.5 7.5h.01',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  filter: 'M3 5h18l-7 8v5l-4 2v-7L3 5z',
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  stroke = 1.8,
  style = {},
}: {
  name: string;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}) {
  const d = PATHS[name] || '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : 'M' + seg} />
      ))}
    </svg>
  );
}

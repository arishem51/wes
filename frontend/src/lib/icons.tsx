// Stroke icon set (1.6 weight) — single source of truth for FE-07 glyphs.
import type { CSSProperties } from 'react';

export const ICON_PATHS: Record<string, string> = {
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 100-6 3 3 0 000 6z',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  key: 'M14 8a4 4 0 11-5.7 3.6L3 17v3h3l1-1h2v-2h2l1.3-1.3A4 4 0 0014 8z M15.5 7.5h.01',
  lock: 'M5 11h14v9H5z M8 11V7a4 4 0 018 0v4',
  unlock: 'M5 11h14v9H5z M8 11V7a4 4 0 017.5-2',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 6',
  chevdown: 'M6 9l6 6 6-6',
  chevright: 'M9 6l6 6-6 6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8z M4 20a8 8 0 0116 0',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8z M2 21a7 7 0 0114 0 M17 11a4 4 0 000-8 M22 21a7 7 0 00-5-6.7',
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  phone: 'M5 4h4l2 5-3 2a14 14 0 006 6l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  warn: 'M12 3l10 17H2L12 3z M12 9v5 M12 17h.01',
  filter: 'M3 5h18l-7 8v5l-4 2v-7L3 5z',
  truck: 'M3 7h11v8H3z M14 10h4l3 3v2h-7 M7 19a2 2 0 100-4 2 2 0 000 4z M18 19a2 2 0 100-4 2 2 0 000 4z',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  gauge: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 12l4-3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3a14 14 0 000 18 M12 3a14 14 0 010 18',
  bell: 'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6 M10 21h4',
  table: 'M3 5h18v14H3z M3 10h18 M9 5v14',
  cards: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  rows: 'M3 6h18M3 12h18M3 18h18',
  refresh: 'M4 12a8 8 0 0114-5l2 2 M20 12a8 8 0 01-14 5l-2-2 M19 4v5h-5 M5 20v-5h5',
};

export type IconName = keyof typeof ICON_PATHS;

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, className = '', style = {} }: IconProps) {
  const d = ICON_PATHS[name] || '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : 'M' + seg} />
      ))}
    </svg>
  );
}

import type { Lang, TFunc } from '@/i18n';

// Demo "now" anchor so relative times in the mock dataset stay stable.
export const NOW = new Date('2026-06-04T09:12:00');

const AVATAR_HUES = [255, 200, 155, 75, 25, 300, 340];

/** Deterministic avatar hue from an id. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % AVATAR_HUES.length;
  return AVATAR_HUES[h];
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/** Relative "x min/h/d ago" string, anchored to NOW. */
export function relTime(iso: string | null, t: TFunc): string {
  if (!iso) return '—';
  const diff = NOW.getTime() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return t('just_now');
  if (m < 60) return `${m} ${t('min_ago')}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${t('hr_ago')}`;
  return `${Math.round(h / 24)} ${t('day_ago')}`;
}

export function fmtDate(iso: string | null, lang: Lang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

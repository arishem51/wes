import type { Lang, TFunc } from '@/i18n';

// Demo "now" anchor so relative times in the mock dataset stay stable.
const NOW = new Date('2026-06-04T09:12:00');

export function relTime(iso: string | null, t: TFunc): string {
  if (!iso) return t('never');
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
  return new Date(iso).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

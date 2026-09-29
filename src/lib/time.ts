// Compact relative time ("3m ago", "2h ago", "5d ago") for panel rows.
export function timeAgo(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

// Long relative time ("10 minutes ago", "1 hour ago", "3 days ago").
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = (then - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', {numeric: 'always'});
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? -1 : 1;
  // Round the magnitude so 90 minutes reads "2 hours ago" either way round.
  const fmt = (unitSeconds: number, unit: Intl.RelativeTimeFormatUnit): string =>
    rtf.format(sign * Math.round(abs / unitSeconds), unit);
  if (abs < 60) return 'just now';
  if (abs < 3600) return fmt(60, 'minute');
  if (abs < 86400) return fmt(3600, 'hour');
  if (abs < 30 * 86400) return fmt(86400, 'day');
  if (abs < 365 * 86400) return fmt(30 * 86400, 'month');
  return fmt(365 * 86400, 'year');
}

// Absolute date and time in the viewer's time zone ("Sep 26 2026, 1:10 PM").
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits free text on commas, semicolons, spaces and newlines; lowercases and de-duplicates. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    (EMAIL_RE.test(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}

/** Value for <input type="datetime-local"> in the browser's local time. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** "Sat, Oct 10, 2026, 6:30 PM GMT+5:30" in the given zone. */
export function formatWhen(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export const DURATION_OPTIONS = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
];

/** "in 2 days", "in 3 hours", "in 12 minutes" -- or "starting now" / "was due 2 hours ago" once past. */
export function timeUntil(iso: string, now: number = Date.now()): { label: string; overdue: boolean } {
  const diffMs = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const sign = diffMs < 0 ? -1 : 1;

  if (abs < 60_000) return { label: 'starting now', overdue: false };
  const text =
    minutes < 60
      ? rtf.format(sign * minutes, 'minute')
      : minutes < 60 * 24
        ? rtf.format(sign * Math.round(minutes / 60), 'hour')
        : rtf.format(sign * Math.round(minutes / (60 * 24)), 'day');
  return diffMs < 0 ? { label: `was due ${text}`, overdue: true } : { label: text, overdue: false };
}

/** Local calendar-day bucket for grouping: "Today", "Tomorrow", or a weekday + date. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days <= 0) return days < 0 ? 'Overdue' : 'Today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

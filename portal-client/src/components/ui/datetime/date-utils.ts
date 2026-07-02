// Shared date/time helpers for the datetime picker family. All pickers speak
// plain strings at their boundaries — 'YYYY-MM-DD', 'YYYY-MM', 'HH:mm' (24h) —
// so values drop straight into query params and API payloads; Date objects
// stay internal to the calendar math (always local time, never UTC, so a
// picked day is the user's day).

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toYm(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function parseYm(s: string | null | undefined): { year: number; month: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year: Number(m[1]), month };
}

export function parseHm(s: string | null | undefined): { hour: number; minute: number } | null {
  if (!s) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function toHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function sameDay(a: Date | null, b: Date | null): boolean {
  return Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
}

/** 'Jun 3, 2026' — the display format every picker trigger uses. */
export function displayDate(ymd: string | null | undefined): string {
  const d = parseYmd(ymd);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** '2:30 PM' from 'HH:mm'. */
export function displayTime(hm: string | null | undefined): string {
  const t = parseHm(hm);
  if (!t) return '';
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h12}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`;
}

/** 'Jul 2026' from 'YYYY-MM'. */
export function displayMonth(ym: string | null | undefined): string {
  const m = parseYm(ym);
  return m ? `${MONTHS_SHORT[m.month]} ${m.year}` : '';
}

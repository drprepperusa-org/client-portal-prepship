export type Preset = 'all' | 'month' | 'lastmonth' | 'h1' | 'h2' | '30' | '90' | 'custom';

/** Local YYYY-MM-DD (date-input format), not UTC, so presets match the user's day. */
export const fmtYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function presetRange(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  let from = new Date();
  let to = new Date();
  if (p === 'all') from = new Date(2020, 0, 1);
  else if (p === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (p === 'lastmonth') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (p === 'h1') {
    // Semi-monthly billing period: 1st–15th. Before the 16th this is the
    // current month's first half; from the 16th on it stays current-month
    // (the running/most recent 1–15 period).
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth(), 15);
  } else if (p === 'h2') {
    // Semi-monthly billing period: 16th–end of month. Before the 16th this
    // points at LAST month's second half (the most recently completed one);
    // from the 16th on it is the current month's.
    if (now.getDate() >= 16) {
      from = new Date(now.getFullYear(), now.getMonth(), 16);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 16);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
    }
  } else if (p === '30') from = new Date(Date.now() - 29 * 86_400_000);
  else if (p === '90') from = new Date(Date.now() - 89 * 86_400_000);
  return { from: fmtYmd(from), to: fmtYmd(to) };
}

export const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'month', label: 'This Month' },
  { id: 'lastmonth', label: 'Last Month' },
  { id: 'h1', label: '1st – 15th' },
  { id: 'h2', label: '16th – End' },
  { id: '30', label: 'Last 30 Days' },
  { id: '90', label: 'Last 90 Days' },
];

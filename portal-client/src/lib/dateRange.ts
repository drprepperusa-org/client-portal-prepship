export type Preset = 'all' | 'month' | 'lastmonth' | '30' | '90' | 'custom';

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
  } else if (p === '30') from = new Date(Date.now() - 29 * 86_400_000);
  else if (p === '90') from = new Date(Date.now() - 89 * 86_400_000);
  return { from: fmtYmd(from), to: fmtYmd(to) };
}

export const PRESETS: { id: Exclude<Preset, 'custom'>; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'month', label: 'This Month' },
  { id: 'lastmonth', label: 'Last Month' },
  { id: '30', label: 'Last 30 Days' },
  { id: '90', label: 'Last 90 Days' },
];

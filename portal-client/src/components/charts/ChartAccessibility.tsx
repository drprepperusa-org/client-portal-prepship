import type { ReactNode } from 'react';

export interface ChartTableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

export function ChartDataTable<T>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: T[];
  columns: ChartTableColumn<T>[];
}) {
  if (!rows.length) return null;
  return (
    <details className="mt-2 rounded-lg bg-white/45 text-xs ring-1 ring-slate-200/70">
      <summary className="focus-ring flex min-h-11 cursor-pointer items-center rounded-lg px-3 py-2 font-semibold text-brand-700">
        View chart data
      </summary>
      <div className="max-h-64 overflow-auto border-t border-slate-200/70">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{title}</caption>
          <thead className="sticky top-0 bg-white/95">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-2 font-semibold text-ink-3">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-slate-100">
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2 text-ink-2">{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ChartDaySelector({
  days,
  onSelect,
}: {
  days: Array<{ day: string; label?: string }>;
  onSelect: (day: string) => void;
}) {
  if (!days.length) return null;
  return (
    <label className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs font-medium text-ink-2">
      <span>View day details</span>
      <select
        value=""
        onChange={(event) => onSelect(event.target.value)}
        className="focus-ring min-h-11 rounded-lg border border-slate-200 bg-white/80 px-3 text-sm text-ink sm:min-h-9"
      >
        <option value="" disabled>Select a day</option>
        {days.map(({ day, label }) => <option key={day} value={day}>{label ?? day}</option>)}
      </select>
    </label>
  );
}

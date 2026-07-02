import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MONTHS_SHORT } from './date-utils';

/**
 * Year header + 12-month grid. The picking surface for MonthPicker, and the
 * month/year jump view inside the day calendar.
 */
export function MonthGrid({
  year,
  onYear,
  selected,
  onPick,
}: {
  year: number;
  onYear: (year: number) => void;
  selected?: { year: number; month: number } | null;
  onPick: (pick: { year: number; month: number }) => void;
}) {
  const nav = 'focus-ring cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink';
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous year" onClick={() => onYear(year - 1)} className={nav}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-ink tabular-nums">{year}</span>
        <button type="button" aria-label="Next year" onClick={() => onYear(year + 1)} className={nav}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS_SHORT.map((name, month) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick({ year, month })}
            className={cn(
              'focus-ring h-9 cursor-pointer rounded-md text-[13px] font-medium transition-colors',
              selected && selected.year === year && selected.month === month
                ? 'bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white'
                : 'text-ink-2 hover:bg-slate-100',
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

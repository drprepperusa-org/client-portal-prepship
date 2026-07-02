import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DOW, MONTHS_SHORT, sameDay } from './date-utils';

/**
 * One-month day grid — the picking surface shared by DatePicker and
 * DateRangePicker. Parent owns the visible month; the header label opens the
 * month/year jump (MonthGrid) when onHeaderClick is provided. Range styling
 * activates when rangeStart/rangeEnd are passed.
 */
export function CalendarMonth({
  year,
  month,
  onNavigate,
  onHeaderClick,
  selected,
  rangeStart,
  rangeEnd,
  min,
  max,
  onPick,
}: {
  year: number;
  month: number;
  onNavigate: (year: number, month: number) => void;
  onHeaderClick?: () => void;
  selected?: Date | null;
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
  min?: Date | null;
  max?: Date | null;
  onPick: (day: Date) => void;
}) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  const today = new Date();

  const disabled = (d: Date) => Boolean((min && d < min) || (max && d > max));
  const isEndpoint = (d: Date) => sameDay(d, selected ?? null) || sameDay(d, rangeStart ?? null) || sameDay(d, rangeEnd ?? null);
  const inRange = (d: Date) => Boolean(rangeStart && rangeEnd && d > rangeStart && d < rangeEnd);

  const nav = 'focus-ring cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink';
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => onNavigate(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)} className={nav}>
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={onHeaderClick}
          className={cn('focus-ring rounded-md px-2 py-1 text-sm font-semibold text-ink', onHeaderClick ? 'cursor-pointer transition-colors hover:bg-slate-100' : 'cursor-default')}
        >
          {MONTHS_SHORT[month]} {year}
        </button>
        <button type="button" aria-label="Next month" onClick={() => onNavigate(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)} className={nav}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-3">
        {DOW.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) =>
          d ? (
            <button
              key={i}
              type="button"
              disabled={disabled(d)}
              onClick={() => onPick(d)}
              className={cn(
                'focus-ring h-8 cursor-pointer rounded-md text-[13px] tabular-nums transition-colors',
                isEndpoint(d)
                  ? 'bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white'
                  : inRange(d)
                    ? 'bg-brand-100 text-brand-700'
                    : 'text-ink-2 hover:bg-slate-100',
                !isEndpoint(d) && !inRange(d) && sameDay(d, today) && 'ring-1 ring-brand-300',
                disabled(d) && 'cursor-not-allowed text-slate-300 hover:bg-transparent',
              )}
            >
              {d.getDate()}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
    </div>
  );
}

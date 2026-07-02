import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { PickerPopover } from './PickerPopover';
import { CalendarMonth } from './CalendarMonth';
import { MonthGrid } from './MonthGrid';
import { displayDate, parseYmd, toYmd } from './date-utils';

/**
 * Start/end range picker in a single calendar popover. The in-progress start
 * date is internal state — onChange fires exactly once per selection, with a
 * complete {start, end} pair (swapped automatically if the second click lands
 * before the first). Parents never see a half-picked range.
 */
export function DateRangePicker({
  label,
  start,
  end,
  onChange,
  placeholder = 'Start → End',
  disabled,
  className,
}: {
  label?: string;
  start: string | null;
  end: string | null;
  onChange: (range: { start: string; end: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [pending, setPending] = useState<Date | null>(null);
  const startDate = parseYmd(start);
  const endDate = parseYmd(end);
  const initial = startDate ?? new Date();
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });

  function openTo(next: boolean) {
    if (next) {
      const d = parseYmd(start) ?? new Date();
      setView({ year: d.getFullYear(), month: d.getMonth() });
      setMode('days');
      setPending(null);
    }
    setOpen(next);
  }

  function pick(d: Date) {
    if (!pending) {
      setPending(d);
      return;
    }
    const [a, b] = d < pending ? [d, pending] : [pending, d];
    onChange({ start: toYmd(a), end: toYmd(b) });
    setPending(null);
    setOpen(false);
  }

  const display = start || end ? `${displayDate(start) || 'Start'} → ${displayDate(end) || 'End'}` : '';

  return (
    <PickerPopover
      label={label}
      icon={<CalendarRange size={15} />}
      display={pending ? `${displayDate(toYmd(pending))} → End` : display}
      placeholder={placeholder}
      open={open}
      onOpenChange={openTo}
      disabled={disabled}
      className={className}
    >
      {mode === 'months' ? (
        <MonthGrid
          year={view.year}
          onYear={(year) => setView((v) => ({ ...v, year }))}
          selected={view}
          onPick={({ year, month }) => {
            setView({ year, month });
            setMode('days');
          }}
        />
      ) : (
        <>
          <CalendarMonth
            year={view.year}
            month={view.month}
            onNavigate={(year, month) => setView({ year, month })}
            onHeaderClick={() => setMode('months')}
            rangeStart={pending ?? startDate}
            rangeEnd={pending ? null : endDate}
            onPick={pick}
          />
          <p className="mt-2 text-center text-[11px] text-ink-3">
            {pending ? 'Now pick the end date' : 'Pick the start date'}
          </p>
        </>
      )}
    </PickerPopover>
  );
}

import { useState } from 'react';
import { Calendar as CalIcon } from 'lucide-react';
import { PickerPopover } from './PickerPopover';
import { CalendarMonth } from './CalendarMonth';
import { MonthGrid } from './MonthGrid';
import { displayDate, parseYmd, toYmd } from './date-utils';

/**
 * Single-date picker. Value is a plain 'YYYY-MM-DD' string (or null), so it
 * drops straight into form drafts and query params. Click the "Jul 2026"
 * header inside the calendar to jump by month/year.
 */
export function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  disabled,
  className,
}: {
  label?: string;
  value: string | null;
  onChange: (value: string) => void;
  min?: string | null;
  max?: string | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const selected = parseYmd(value);
  const initial = selected ?? new Date();
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });

  function openTo(next: boolean) {
    if (next) {
      const d = parseYmd(value) ?? new Date();
      setView({ year: d.getFullYear(), month: d.getMonth() });
      setMode('days');
    }
    setOpen(next);
  }

  return (
    <PickerPopover
      label={label}
      icon={<CalIcon size={15} />}
      display={displayDate(value)}
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
        <CalendarMonth
          year={view.year}
          month={view.month}
          onNavigate={(year, month) => setView({ year, month })}
          onHeaderClick={() => setMode('months')}
          selected={selected}
          min={parseYmd(min)}
          max={parseYmd(max)}
          onPick={(d) => {
            onChange(toYmd(d));
            setOpen(false);
          }}
        />
      )}
    </PickerPopover>
  );
}

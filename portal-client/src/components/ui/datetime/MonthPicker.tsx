import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { PickerPopover } from './PickerPopover';
import { MonthGrid } from './MonthGrid';
import { displayMonth, parseYm, toYm } from './date-utils';

/** Month picker. Value is a plain 'YYYY-MM' string (or null). */
export function MonthPicker({
  label,
  value,
  onChange,
  placeholder = 'Pick a month',
  disabled,
  className,
}: {
  label?: string;
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseYm(value);
  const [year, setYear] = useState(selected?.year ?? new Date().getFullYear());

  function openTo(next: boolean) {
    if (next) setYear(parseYm(value)?.year ?? new Date().getFullYear());
    setOpen(next);
  }

  return (
    <PickerPopover
      label={label}
      icon={<CalendarDays size={15} />}
      display={displayMonth(value)}
      placeholder={placeholder}
      open={open}
      onOpenChange={openTo}
      width={260}
      disabled={disabled}
      className={className}
    >
      <MonthGrid
        year={year}
        onYear={setYear}
        selected={selected}
        onPick={({ year: y, month }) => {
          onChange(toYm(y, month));
          setOpen(false);
        }}
      />
    </PickerPopover>
  );
}

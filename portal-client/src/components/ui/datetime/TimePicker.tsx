import { useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PickerPopover } from './PickerPopover';
import { displayTime, parseHm, toHm } from './date-utils';

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/**
 * Time picker. Value is a plain 24h 'HH:mm' string (or null); the UI is
 * 12-hour with an AM/PM toggle and 5-minute steps. Picking an hour keeps the
 * popover open for the minute; picking a minute commits and closes.
 */
export function TimePicker({
  label,
  value,
  onChange,
  placeholder = 'Pick a time',
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
  const current = parseHm(value);
  const pm = (current?.hour ?? 9) >= 12;
  const hour12 = current ? (current.hour % 12 === 0 ? 12 : current.hour % 12) : null;

  function to24(h12: number, isPm: boolean): number {
    return (h12 % 12) + (isPm ? 12 : 0);
  }
  function commit(h12: number | null, minute: number | null, isPm: boolean) {
    const h = to24(h12 ?? hour12 ?? 9, isPm);
    const m = minute ?? current?.minute ?? 0;
    onChange(toHm(h, m));
  }

  const cell = (active: boolean) =>
    cn(
      'focus-ring h-8 cursor-pointer rounded-md text-[13px] tabular-nums transition-colors',
      active ? 'bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white' : 'text-ink-2 hover:bg-slate-100',
    );

  return (
    <PickerPopover
      label={label}
      icon={<Clock size={15} />}
      display={displayTime(value)}
      placeholder={placeholder}
      open={open}
      onOpenChange={setOpen}
      width={264}
      disabled={disabled}
      className={className}
    >
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-slate-100/70 p-1">
        {(['AM', 'PM'] as const).map((half) => (
          <button
            key={half}
            type="button"
            onClick={() => commit(hour12, current?.minute ?? null, half === 'PM')}
            className={cn(
              'focus-ring cursor-pointer rounded px-2 py-1 text-xs font-semibold transition-colors',
              (half === 'PM') === pm && current ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-3 hover:text-ink',
            )}
          >
            {half}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-center text-[11px] font-semibold text-ink-3">Hour</p>
          <div className="grid grid-cols-3 gap-1">
            {HOURS_12.map((h) => (
              <button key={h} type="button" onClick={() => commit(h, current?.minute ?? null, pm)} className={cell(hour12 === h)}>
                {h}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-center text-[11px] font-semibold text-ink-3">Minute</p>
          <div className="grid grid-cols-3 gap-1">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  commit(hour12, m, pm);
                  setOpen(false);
                }}
                className={cell(Boolean(current) && current?.minute === m)}
              >
                :{String(m).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PickerPopover>
  );
}

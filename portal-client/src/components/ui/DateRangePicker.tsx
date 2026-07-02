import { PRESETS, type Preset } from '@/lib/dateRange';
import { DateRangePicker as DateRangeCalendar } from '@/components/ui/datetime';
import { cn } from '@/lib/cn';

/**
 * Preset + custom date-range picker. Presentational: the parent owns the
 * `from`/`to`/`preset` state and the query that uses it. Custom ranges use
 * the datetime family's calendar popover, which keeps the in-progress start
 * internal and reports onFrom + onTo together only when the user completes
 * the range — parents never observe a half-picked range.
 */
export function DateRangePicker({
  from,
  to,
  preset,
  onPreset,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  preset: Preset;
  onPreset: (p: Exclude<Preset, 'custom'>) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => onPreset(p.id)}
          className={cn(
            'focus-ring cursor-pointer rounded-glass-sm px-3 py-1.5 text-sm font-medium transition-colors',
            preset === p.id ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass' : 'bg-white/60 text-ink-2 ring-1 ring-slate-200/70 hover:bg-white',
          )}
        >
          {p.label}
        </button>
      ))}
      <DateRangeCalendar
        start={from}
        end={to}
        onChange={({ start, end }) => {
          onFrom(start);
          onTo(end);
        }}
        className="w-64"
      />
      {preset === 'custom' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Custom</span>}
    </div>
  );
}

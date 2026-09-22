import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { CalendarDays, Check, ChevronDown, X } from 'lucide-react';
import { CalendarMonth, MONTHS_SHORT, parseYmd, sameDay, toYmd } from '@/components/ui/datetime';
import { usePortalFilters } from '@/lib/portalContext';
import type { PortalDateRange } from '@/lib/api';
import { cn } from '@/lib/cn';

type PresetId =
  | 'today'
  | 'yesterday'
  | 'last_7'
  | 'last_15'
  | 'last_30'
  | 'this_month'
  | 'last_month'
  | 'last_90'
  | 'year_to_date';

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_7', label: 'Last 7 days' },
  { id: 'last_15', label: 'Last 15 days' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_90', label: 'Last 90 days' },
  { id: 'year_to_date', label: 'Year to date' },
];

function startOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function monthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

function range(dateFrom: Date, dateTo: Date, preset: PresetId | 'custom'): PortalDateRange {
  const [from, to] = dateFrom <= dateTo ? [dateFrom, dateTo] : [dateTo, dateFrom];
  return { dateFrom: toYmd(from), dateTo: toYmd(to), preset };
}

function presetRange(preset: PresetId): PortalDateRange {
  const today = startOfDay(new Date());
  if (preset === 'today') return range(today, today, preset);
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return range(yesterday, yesterday, preset);
  }
  if (preset === 'last_7') return range(addDays(today, -6), today, preset);
  if (preset === 'last_15') return range(addDays(today, -14), today, preset);
  if (preset === 'last_30') return range(addDays(today, -29), today, preset);
  if (preset === 'this_month') return range(new Date(today.getFullYear(), today.getMonth(), 1), today, preset);
  if (preset === 'last_month') {
    const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const month = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    return range(new Date(year, month, 1), monthEnd(year, month), preset);
  }
  if (preset === 'last_90') return range(addDays(today, -89), today, preset);
  return range(new Date(today.getFullYear(), 0, 1), today, preset);
}

function shortDay(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function rangeLabel(dateRange: PortalDateRange['dateFrom'], dateTo: PortalDateRange['dateTo']): string {
  const from = parseYmd(dateRange);
  const to = parseYmd(dateTo);
  if (!from || !to) return 'Date range';
  if (sameDay(from, to)) return `${shortDay(from)}, ${from.getFullYear()}`;
  if (from.getFullYear() === to.getFullYear()) {
    return `${shortDay(from)} - ${shortDay(to)}, ${to.getFullYear()}`;
  }
  return `${shortDay(from)}, ${from.getFullYear()} - ${shortDay(to)}, ${to.getFullYear()}`;
}

function sameRange(a: PortalDateRange, b: PortalDateRange): boolean {
  return a.dateFrom === b.dateFrom && a.dateTo === b.dateTo;
}

function viewFromRange(next: PortalDateRange): { year: number; month: number } {
  const start = parseYmd(next.dateFrom) ?? new Date();
  return { year: start.getFullYear(), month: start.getMonth() };
}

export function DateRangeFilter() {
  const { dateRange, setDateRange } = usePortalFilters();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PortalDateRange>(dateRange);
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [view, setView] = useState(viewFromRange(dateRange));

  useEffect(() => {
    if (!open) return;
    setDraft(dateRange);
    setPendingStart(null);
    setView(viewFromRange(dateRange));
  }, [dateRange, open]);

  const draftStart = parseYmd(draft.dateFrom);
  const draftEnd = parseYmd(draft.dateTo);
  const activePreset = PRESETS.find((preset) => sameRange(presetRange(preset.id), draft))?.id ?? draft.preset;

  function choosePreset(preset: PresetId) {
    const next = presetRange(preset);
    setDraft(next);
    setPendingStart(null);
    setView(viewFromRange(next));
  }

  function pickDay(day: Date) {
    const picked = startOfDay(day);
    if (!pendingStart) {
      setPendingStart(picked);
      setDraft(range(picked, picked, 'custom'));
      return;
    }
    const next = range(pendingStart, picked, 'custom');
    setDraft(next);
    setPendingStart(null);
    setView(viewFromRange(next));
  }

  function updateDraft(part: 'dateFrom' | 'dateTo', value: string) {
    const parsed = parseYmd(value);
    if (!parsed) return;
    const currentFrom = parseYmd(draft.dateFrom) ?? parsed;
    const currentTo = parseYmd(draft.dateTo) ?? parsed;
    const next = part === 'dateFrom' ? range(parsed, currentTo, 'custom') : range(currentFrom, parsed, 'custom');
    setDraft(next);
    setPendingStart(null);
    setView(viewFromRange(next));
  }

  function apply() {
    setDateRange(draft);
    setOpen(false);
  }

  return (
    <div className="min-w-0 flex-1 sm:flex-none">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        aria-label="Date range filter"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="focus-ring flex h-11 w-full cursor-pointer items-center gap-2 rounded-glass-sm border border-white/80 bg-white/60 px-3 text-sm text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90 sm:h-10"
      >
        <CalendarDays size={15} className="shrink-0 text-ink-3" />
        <span className="max-w-[13rem] truncate sm:hidden lg:inline">{rangeLabel(dateRange.dateFrom, dateRange.dateTo)}</span>
        <span className="hidden sm:inline lg:hidden">{dateRange.preset === 'last_30' ? 'Last 30 days' : 'Date range'}</span>
        <ChevronDown size={15} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Date range" maxWidth={660}>
        <div className="grid sm:grid-cols-[170px_minmax(0,1fr)]">
          <div className="grid grid-cols-2 gap-1 border-b border-white/70 bg-white/45 pb-3 sm:block sm:border-b-0 sm:border-r sm:p-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => choosePreset(preset.id)}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center justify-between rounded-md px-3 text-left text-sm transition-colors',
                  activePreset === preset.id ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-slate-100',
                )}
              >
                <span>{preset.label}</span>
                {activePreset === preset.id && <Check size={15} className="shrink-0 text-brand-600" />}
              </button>
            ))}
          </div>

          <div className="min-w-0 pt-3 sm:p-3 [&_button]:min-h-11">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">{MONTHS_SHORT[view.month]} {view.year}</p>
              <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[11px] font-bold text-ink-3">
                <span className="rounded bg-brand-500 px-2 py-1 text-white">D</span>
                <span className="px-2 py-1">M</span>
                <span className="px-2 py-1">Y</span>
              </div>
            </div>

            <CalendarMonth
              year={view.year}
              month={view.month}
              onNavigate={(year, month) => setView({ year, month })}
              rangeStart={pendingStart ?? draftStart}
              rangeEnd={pendingStart ? null : draftEnd}
              onPick={pickDay}
            />

            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label className="min-w-[130px] max-w-full flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-ink-3">FROM</span>
                <input
                  type="date"
                  value={draft.dateFrom}
                  onChange={(event) => updateDraft('dateFrom', event.target.value)}
                  className="focus-ring h-11 w-full rounded-md border border-slate-200 bg-white/80 px-2 text-sm text-ink"
                />
              </label>
              <label className="min-w-[130px] max-w-full flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-ink-3">TO</span>
                <input
                  type="date"
                  value={draft.dateTo}
                  onChange={(event) => updateDraft('dateTo', event.target.value)}
                  className="focus-ring h-11 w-full rounded-md border border-slate-200 bg-white/80 px-2 text-sm text-ink"
                />
              </label>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="focus-ring inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white/70 px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-white"
              >
                <X size={14} /> Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className={cn('focus-ring inline-flex h-11 cursor-pointer items-center rounded-md bg-gradient-to-br from-brand-400 to-brand-600 px-4',
                  'text-sm font-semibold text-white shadow-glass transition-opacity hover:opacity-95')}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

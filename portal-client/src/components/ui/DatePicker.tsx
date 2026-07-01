import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar as CalIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function fmt(d: Date | null) {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
function sameDay(a: Date | null, b: Date | null) {
  return Boolean(a && b && a.toDateString() === b.toDateString());
}

interface DatePickerProps {
  label?: string;
  range?: boolean;
  value: { start: Date | null; end: Date | null };
  onChange: (v: { start: Date | null; end: Date | null }) => void;
  className?: string;
}
export function DatePicker({ label, range = false, value, onChange, className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => value.start ?? new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const year = view.getFullYear();
  const month = view.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];

  function pick(d: Date) {
    if (!range) {
      onChange({ start: d, end: d });
      setOpen(false);
      return;
    }
    if (!value.start || (value.start && value.end)) {
      onChange({ start: d, end: null });
    } else if (d < value.start) {
      onChange({ start: d, end: value.start });
    } else {
      onChange({ start: value.start, end: d });
    }
  }

  const inRange = (d: Date) => value.start && value.end && d > value.start && d < value.end;
  const display = range ? `${fmt(value.start) || 'Start'} → ${fmt(value.end) || 'End'}` : fmt(value.start) || 'Pick a date';

  return (
    <div className={cn('flex flex-col gap-1.5', className)} ref={ref}>
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'focus-ring flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-glass-sm border border-white/80 bg-white/70 px-3.5 text-left text-[15px] ring-1 ring-slate-200/70 backdrop-blur-sm transition-colors hover:bg-white/90',
            open && 'border-brand-400 shadow-[0_0_0_3px_rgba(3, 169, 244,0.18)]',
          )}
        >
          <CalIcon size={16} className="text-brand-500" />
          <span className={cn(value.start ? 'text-ink' : 'text-slate-400')}>{display}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="glass-strong absolute z-30 mt-2 w-[300px] rounded-glass-sm p-3 shadow-glass-lg"
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setView(new Date(year, month - 1, 1))}
                  className="focus-ring cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-ink">{MONTHS[month]} {year}</span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setView(new Date(year, month + 1, 1))}
                  className="focus-ring cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-3">
                {DOW.map((d, i) => <span key={i}>{d}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) =>
                  d ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pick(d)}
                      className={cn(
                        'focus-ring h-8 cursor-pointer rounded-md text-[13px] tabular-nums transition-colors',
                        sameDay(d, value.start) || sameDay(d, value.end)
                          ? 'bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white'
                          : inRange(d)
                            ? 'bg-brand-100 text-brand-700'
                            : 'text-ink-2 hover:bg-slate-100',
                      )}
                    >
                      {d.getDate()}
                    </button>
                  ) : (
                    <span key={i} />
                  ),
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

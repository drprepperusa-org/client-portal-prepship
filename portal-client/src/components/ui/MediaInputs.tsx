import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar as CalIcon, ChevronLeft, ChevronRight, UploadCloud, File as FileIcon, X, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ============ Date / Date-range picker ============ */
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
        <button type="button" onClick={() => setOpen((o) => !o)} className={cn('focus-ring flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-glass-sm border border-white/80 bg-white/70 px-3.5 text-left text-[15px] ring-1 ring-slate-200/70 backdrop-blur-sm transition-colors hover:bg-white/90', open && 'border-brand-400 shadow-[0_0_0_3px_rgba(3, 169, 244,0.18)]')}>
          <CalIcon size={16} className="text-brand-500" />
          <span className={cn(value.start ? 'text-ink' : 'text-slate-400')}>{display}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.16 }} className="glass-strong absolute z-30 mt-2 w-[300px] rounded-glass-sm p-3 shadow-glass-lg">
              <div className="mb-2 flex items-center justify-between">
                <button type="button" aria-label="Previous month" onClick={() => setView(new Date(year, month - 1, 1))} className="focus-ring cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink"><ChevronLeft size={16} /></button>
                <span className="text-sm font-semibold text-ink">{MONTHS[month]} {year}</span>
                <button type="button" aria-label="Next month" onClick={() => setView(new Date(year, month + 1, 1))} className="focus-ring cursor-pointer rounded-md p-1.5 text-ink-3 transition-colors hover:bg-slate-100 hover:text-ink"><ChevronRight size={16} /></button>
              </div>
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-3">
                {DOW.map((d, i) => <span key={i}>{d}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) =>
                  d ? (
                    <button key={i} type="button" onClick={() => pick(d)} className={cn('focus-ring h-8 cursor-pointer rounded-md text-[13px] tabular-nums transition-colors', sameDay(d, value.start) || sameDay(d, value.end) ? 'bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white' : inRange(d) ? 'bg-brand-100 text-brand-700' : 'text-ink-2 hover:bg-slate-100')}>
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

/* ============ File upload (drag-drop + preview + progress) ============ */
interface UploadItem {
  id: number;
  name: string;
  size: number;
  progress: number;
  url?: string;
  type: string;
}
export function FileUpload({ label }: { label?: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track created object URLs so previews don't leak (revoked on remove + unmount).
  const urlsRef = useRef<string[]>([]);
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function add(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const id = Date.now() + Math.random();
      const url = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      if (url) urlsRef.current.push(url);
      setItems((prev) => [...prev, { id, name: f.name, size: f.size, progress: 0, url, type: f.type }]);
      // simulate upload progress
      const tick = setInterval(() => {
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id) return it;
            const next = Math.min(100, it.progress + Math.random() * 26);
            if (next >= 100) clearInterval(tick);
            return { ...it, progress: next };
          }),
        );
      }, 240);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={cn('focus-ring flex cursor-pointer flex-col items-center justify-center gap-2 rounded-glass border-2 border-dashed px-6 py-8 text-center transition-all duration-200', drag ? 'border-brand-400 bg-brand-50/70' : 'border-slate-300 bg-white/50 hover:border-brand-300 hover:bg-brand-50/40')}
      >
        <motion.span animate={drag ? { y: -4, scale: 1.1 } : { y: 0, scale: 1 }} className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass">
          <UploadCloud size={22} />
        </motion.span>
        <p className="text-sm font-semibold text-ink">Drop files here, or <span className="text-brand-600">browse</span></p>
        <p className="text-xs text-ink-3">PNG, JPG, PDF or CSV up to 25MB</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </div>
      <AnimatePresence>
        {items.map((it) => (
          <motion.div key={it.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="glass flex items-center gap-3 rounded-glass-sm p-2.5">
            {it.url ? <img src={it.url} alt={it.name} className="h-10 w-10 rounded-md object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-100 text-brand-600"><FileIcon size={18} /></span>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-ink">{it.name}</p>
                <span className="shrink-0 text-xs text-ink-3">{(it.size / 1024).toFixed(0)} KB</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <motion.div className={cn('h-full rounded-full', it.progress >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-400 to-brand-600')} animate={{ width: `${it.progress}%` }} transition={{ ease: 'easeOut' }} />
              </div>
            </div>
            {it.progress >= 100 ? <Check size={16} className="text-emerald-500" /> : <button aria-label="Remove file" onClick={(e) => { e.stopPropagation(); if (it.url) URL.revokeObjectURL(it.url); setItems((p) => p.filter((x) => x.id !== it.id)); }} className="focus-ring cursor-pointer rounded p-1 text-ink-3 hover:text-rose-500"><X size={15} /></button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ============ Color picker ============ */
const SWATCHES = ['#03A9F4', '#14B8A6', '#F59E0B', '#F43F5E', '#10B981', '#0EA5E9', '#8B5CF6', '#1E293B'];
export function ColorPicker({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div className="flex flex-col gap-1.5" ref={ref}>
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} className="focus-ring flex h-11 cursor-pointer items-center gap-2.5 rounded-glass-sm border border-white/80 bg-white/70 px-3 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90">
          <span className="h-6 w-6 rounded-md ring-1 ring-black/10" style={{ backgroundColor: value }} />
          <span className="font-mono text-sm uppercase text-ink">{value}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.16 }} className="glass-strong absolute z-30 mt-2 w-56 rounded-glass-sm p-3 shadow-glass-lg">
              <div className="grid grid-cols-4 gap-2">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" aria-label={c} onClick={() => { onChange(c); setOpen(false); }} className={cn('focus-ring h-9 w-full cursor-pointer rounded-md ring-1 ring-black/10 transition-transform hover:scale-110', value === c && 'ring-2 ring-offset-2 ring-brand-500')} style={{ backgroundColor: c }} />
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                Custom
                <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-full cursor-pointer rounded bg-transparent" />
              </label>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

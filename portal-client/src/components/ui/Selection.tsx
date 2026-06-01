import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ---------- Checkbox ---------- */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer select-none items-center gap-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <span className="relative inline-flex">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className={cn('focus-ring grid h-5 w-5 place-items-center rounded-[7px] border transition-all duration-200', checked ? 'border-brand-500 bg-gradient-to-br from-brand-400 to-brand-600 shadow-[0_2px_8px_rgba(3, 169, 244,0.4)]' : 'border-slate-300 bg-white/70', 'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-400/55')}>
          <AnimatePresence>
            {checked && (
              <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
                <Check size={13} className="text-white" strokeWidth={3.5} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </span>
      <span className="text-sm text-ink-2">{label}</span>
    </label>
  );
}

/* ---------- Radio group ---------- */
export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <label key={o.value} className="inline-flex cursor-pointer select-none items-center gap-2.5">
              <span className="relative inline-flex">
                <input type="radio" name={name} checked={active} onChange={() => onChange(o.value)} className="peer sr-only" />
                <span className={cn('focus-ring grid h-5 w-5 place-items-center rounded-full border transition-all duration-200', active ? 'border-brand-500' : 'border-slate-300 bg-white/70', 'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-400/55')}>
                  <AnimatePresence>
                    {active && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }} className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-brand-400 to-brand-600" />}
                  </AnimatePresence>
                </span>
              </span>
              <span className="text-sm text-ink-2">{o.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Select (searchable, single + multi) ---------- */
export interface Option {
  value: string;
  label: string;
}
interface SelectProps {
  label?: string;
  options: Option[];
  placeholder?: string;
  searchable?: boolean;
  multiple?: boolean;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  className?: string;
}
export function Select({ label, options, placeholder = 'Select…', searchable = false, multiple = false, value, onChange, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Fixed-position coords for the portalled menu (viewport-relative).
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Position the menu under (or above, if near the viewport bottom) the trigger.
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estHeight = Math.min(264, (searchable ? 44 : 0) + Math.max(1, options.length) * 40 + 12);
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < estHeight + 12 && r.top > spaceBelow;
    setPos({
      top: flipUp ? Math.max(8, r.top - estHeight - 6) : r.bottom + 6,
      left: r.left,
      width: r.width,
    });
  }, [options.length, searchable]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const handler = () => reposition();
    // capture:true so we also catch scrolls inside scrollable ancestors.
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, reposition]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = multiple ? (value as string[]) : [value as string].filter(Boolean);
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  function toggle(v: string) {
    if (multiple) {
      const set = new Set(value as string[]);
      set.has(v) ? set.delete(v) : set.add(v);
      onChange([...set]);
    } else {
      onChange(v);
      setOpen(false);
    }
  }

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn('focus-ring flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-glass-sm border border-white/80 bg-white/70 px-3.5 py-1.5 text-left text-[15px] ring-1 ring-slate-200/70 backdrop-blur-sm transition-colors hover:bg-white/90', open && 'border-brand-400 shadow-[0_0_0_3px_rgba(3, 169, 244,0.18)]')}
        >
          <span className={cn('flex flex-1 flex-wrap items-center gap-1.5', selected.length === 0 && 'text-slate-400')}>
            {selected.length === 0 && placeholder}
            {multiple
              ? selected.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-1.5 py-0.5 text-xs font-medium text-brand-700">
                  {labelFor(v)}
                  <X size={11} className="cursor-pointer hover:text-rose-500" onClick={(e) => { e.stopPropagation(); toggle(v); }} />
                </span>
              ))
              : selected.length > 0 && <span className="truncate text-ink">{labelFor(selected[0])}</span>}
          </span>
          <ChevronDown size={17} className={cn('shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')} />
        </button>

        {createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
                className="glass-strong z-[60] max-h-64 overflow-auto rounded-glass-sm p-1.5 shadow-glass-lg"
                role="listbox"
              >
                {searchable && (
                  <div className="sticky top-0 mb-1 flex items-center gap-2 rounded-md bg-white/80 px-2.5 py-1.5">
                    <Search size={14} className="text-ink-3" />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-400" />
                  </div>
                )}
                {filtered.length === 0 && <p className="px-3 py-4 text-center text-sm text-ink-3">No matches</p>}
                {filtered.map((o) => {
                  const active = selected.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggle(o.value)}
                      className={cn('flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors', active ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-slate-100/80')}
                    >
                      {o.label}
                      {active && <Check size={15} className="text-brand-600" />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>
    </div>
  );
}

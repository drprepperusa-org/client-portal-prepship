import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';

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
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="focus-ring flex h-11 cursor-pointer items-center gap-2.5 rounded-glass-sm border border-white/80 bg-white/70 px-3 ring-1 ring-slate-200/70 transition-colors hover:bg-white/90"
        >
          <span className="h-6 w-6 rounded-md ring-1 ring-black/10" style={{ backgroundColor: value }} />
          <span className="font-mono text-sm uppercase text-ink">{value}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="glass-strong absolute z-30 mt-2 w-56 rounded-glass-sm p-3 shadow-glass-lg"
            >
              <div className="grid grid-cols-4 gap-2">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                    className={cn(
                      'focus-ring h-9 w-full cursor-pointer rounded-md ring-1 ring-black/10 transition-transform hover:scale-110',
                      value === c && 'ring-2 ring-offset-2 ring-brand-500',
                    )}
                    style={{ backgroundColor: c }}
                  />
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

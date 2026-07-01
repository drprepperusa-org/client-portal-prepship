import { useEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { liquidSpring, staggerItem } from '@/lib/motion';

/* ───────────────────────── count-up headline ───────────────────────── */

function useCountUp(target: number, active: boolean, duration = 720) {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(target);
  useEffect(() => {
    if (!active) return;
    if (reduce) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduce, duration]);
  return val;
}

export function CountUp({ value, active, format }: { value: number; active: boolean; format: (n: number) => string }) {
  const v = useCountUp(value, active);
  return <>{format(v)}</>;
}

export function niceDate(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ───────────────────────── small building blocks ───────────────────────── */

export function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <motion.div variants={staggerItem} className="rounded-glass-sm bg-white/55 px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-0.5 font-display text-base font-bold text-ink tnum">{value}</p>
    </motion.div>
  );
}

export function SkuBar({ sku, value, max, color, display }: { sku: string; value: number; max: number; color: string; display: string }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <motion.div variants={staggerItem} className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate font-mono text-[12px] text-ink-2" title={sku}>{sku}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ ...liquidSpring, delay: 0.12 }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-[12px] font-semibold text-ink tnum">{display}</span>
    </motion.div>
  );
}

export function PeekSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div variants={staggerItem}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      {children}
    </motion.div>
  );
}

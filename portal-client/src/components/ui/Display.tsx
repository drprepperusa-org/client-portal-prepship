import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import { ACCENTS, type Accent } from '@/lib/accents';

/* ---------- Status chip ---------- */
export function Chip({ children, accent = 'indigo', dot = true, className }: { children: ReactNode; accent?: Accent; dot?: boolean; className?: string }) {
  const a = ACCENTS[accent];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1', a.bg, a.text, a.ring, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: a.solid }} />}
      {children}
    </span>
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon, title, message, action }: { icon: ReactNode; title: string; message?: string; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-100 to-brand-50 text-brand-500 shadow-inner">{icon}</span>
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      {message && <p className="max-w-sm text-sm text-ink-3">{message}</p>}
      {action}
    </motion.div>
  );
}

/* ---------- Tooltip ---------- */
export function Tooltip({ label, children, side = 'right' }: { label: string; children: ReactNode; side?: 'right' | 'top' }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
      {children}
      <AnimatePresence>
        {show && (
          <motion.span
            initial={{ opacity: 0, x: side === 'right' ? -6 : 0, y: side === 'top' ? 6 : 0, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.14 }}
            role="tooltip"
            className={cn('pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-lg', side === 'right' ? 'left-full top-1/2 ml-2.5 -translate-y-1/2' : 'bottom-full left-1/2 mb-2 -translate-x-1/2')}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ---------- Progress bar ---------- */
export function ProgressBar({ value, accent = 'indigo' }: { value: number; accent?: Accent }) {
  const a = ACCENTS[accent];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
      <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${a.solid}cc, ${a.solid})` }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, value)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
    </div>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="grid place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white shadow-glass" style={{ height: size, width: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

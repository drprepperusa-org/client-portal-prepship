import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
export function Tooltip({
  label,
  children,
  side = 'right',
  multiline = false,
}: {
  label: string;
  children: ReactNode;
  side?: 'right' | 'top';
  /** Wrap long explanatory copy in a fixed-width bubble instead of one nowrap line. */
  multiline?: boolean;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = () => setRect(anchorRef.current?.getBoundingClientRect() ?? null);
  const hide = () => setRect(null);

  // The bubble is position:fixed at the document level, so a scroll or resize
  // would leave it stranded at stale coordinates — just dismiss it.
  useEffect(() => {
    if (!rect) return;
    const dismiss = () => setRect(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [rect]);

  // Rendered through a portal with fixed coordinates so no ancestor overflow
  // can clip it — an overflow-x-auto table wrapper is a scroll container that
  // clips vertical overflow too, which swallowed in-flow bubbles entirely.
  const BUBBLE_HALF = 128; // w-64 / 2 — keeps multiline bubbles on screen
  const position = rect
    ? side === 'top'
      ? {
          left: multiline
            ? Math.min(Math.max(rect.left + rect.width / 2, BUBBLE_HALF + 8), window.innerWidth - BUBBLE_HALF - 8)
            : rect.left + rect.width / 2,
          top: rect.top - 8,
          transform: 'translate(-50%, -100%)',
        }
      : {
          left: rect.right + 10,
          top: rect.top + rect.height / 2,
          transform: 'translateY(-50%)',
        }
    : null;

  return (
    <span ref={anchorRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {createPortal(
        <AnimatePresence>
          {position && (
            <span className="pointer-events-none fixed z-50" style={position}>
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.14 }}
                role="tooltip"
                className={cn(
                  'block rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-lg',
                  // Explicit casing/leading: the bubble no longer inherits from
                  // the anchor (e.g. uppercase table headers), keep it that way.
                  multiline
                    ? 'w-64 whitespace-normal text-left font-normal normal-case leading-relaxed tracking-normal'
                    : 'whitespace-nowrap',
                )}
              >
                {label}
              </motion.span>
            </span>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}

/* ---------- Progress bar ---------- */
export function ProgressBar({ value, accent = 'indigo' }: { value: number; accent?: Accent }) {
  const a = ACCENTS[accent];
  const background = `linear-gradient(90deg, ${a.solid}cc, ${a.solid})`;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
      <motion.div
        className="h-full rounded-full"
        style={{ background }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, value)}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
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

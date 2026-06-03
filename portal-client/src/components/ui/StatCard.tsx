import type { KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Maximize2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { GlassPanel } from './Glass';
import { AnimatedIcon } from './AnimatedIcon';
import type { Accent } from '@/lib/accents';
import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  delta,
  icon,
  accent = 'indigo',
  hint,
  onPeek,
}: {
  label: string;
  value: string;
  delta?: number;
  icon: LucideIcon;
  accent?: Accent;
  hint?: string;
  /** When set, the card becomes a "tap for a live peek" trigger. Receives the
   *  card's on-screen rect so the modal can grow out of exactly this card. */
  onPeek?: (rect: DOMRect) => void;
}) {
  const up = (delta ?? 0) >= 0;
  const interactive = Boolean(onPeek);
  const fire = (el: HTMLElement | null) => el && onPeek?.(el.getBoundingClientRect());

  return (
    <GlassPanel
      asItem
      hover
      className={cn('group relative p-5', interactive && 'focus-ring')}
      onClick={interactive ? (e) => fire(e.currentTarget) : undefined}
      onKeyDown={
        interactive
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fire(e.currentTarget);
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${label}: ${value}. View live details` : undefined}
    >
      <div className="flex items-start justify-between">
        <AnimatedIcon icon={icon} accent={accent} tile />
        <div className="flex items-center gap-2">
          {delta !== undefined && (
            <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold', up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600')}>
              {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {Math.abs(delta)}%
            </span>
          )}
          {interactive && (
            <span className="grid h-7 w-7 place-items-center rounded-lg text-ink-3 opacity-0 ring-1 ring-slate-200/70 transition-all duration-200 group-hover:bg-white/70 group-hover:opacity-100 group-focus-visible:opacity-100">
              <Maximize2 size={14} />
            </span>
          )}
        </div>
      </div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 font-display text-2xl font-bold tracking-tight text-ink tnum">
        {value}
      </motion.p>
      <p className="mt-1 text-sm font-medium text-ink-3">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3/80">{hint}</p>}
      {interactive && (
        <span className="pointer-events-none mt-2 inline-flex items-center text-[11px] font-medium text-ink-3/0 transition-colors duration-200 group-hover:text-ink-3/80">
          Tap for live view
        </span>
      )}
    </GlassPanel>
  );
}

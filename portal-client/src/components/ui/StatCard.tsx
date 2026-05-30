import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
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
}: {
  label: string;
  value: string;
  delta?: number;
  icon: LucideIcon;
  accent?: Accent;
  hint?: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <GlassPanel asItem hover className="p-5">
      <div className="flex items-start justify-between">
        <AnimatedIcon icon={icon} accent={accent} tile />
        {delta !== undefined && (
          <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold', up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600')}>
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 font-display text-2xl font-bold tracking-tight text-ink tnum">
        {value}
      </motion.p>
      <p className="mt-1 text-sm font-medium text-ink-3">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3/80">{hint}</p>}
    </GlassPanel>
  );
}

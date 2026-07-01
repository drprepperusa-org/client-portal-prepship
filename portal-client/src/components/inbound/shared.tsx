import type { ReactNode } from 'react';
import { type Accent } from '@/lib/accents';

export const STATUSES = ['expected', 'in_transit', 'received', 'cancelled'] as const;
export const STATUS_META: Record<string, { label: string; accent: Accent }> = {
  expected: { label: 'Expected', accent: 'amber' },
  in_transit: { label: 'In transit', accent: 'sky' },
  received: { label: 'Received', accent: 'emerald' },
  cancelled: { label: 'Cancelled', accent: 'rose' },
};

export const field = 'focus-ring h-10 w-full rounded-glass-sm border border-white/80 bg-white/60 px-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90';

export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

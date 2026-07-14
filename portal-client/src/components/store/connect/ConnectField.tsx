import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function connectInputClass(invalid: boolean) {
  return cn(
    'h-11 w-full rounded-glass-sm border bg-white/70 px-3.5 text-[15px] text-ink ring-1 backdrop-blur-sm transition-colors placeholder:text-slate-400 focus:bg-white/90 focus:outline-none',
    invalid
      ? 'border-rose-300 ring-rose-200 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]'
      : 'border-white/80 ring-slate-200/70 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(3,169,244,0.18)]',
  );
}

export function ConnectField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-ink-3">{label}</span>
      <span className="max-w-[60%] truncate font-medium text-ink">{value || '—'}</span>
    </div>
  );
}

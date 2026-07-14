import { ArrowLeft, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { StorePlatform } from '@/data/storePlatforms';
import { StoreLogo } from '../StoreLogo';
import { ReviewRow } from './ConnectField';

export function StoreConnectionReview({
  platform,
  storeName,
  values,
  onBack,
  onConfirm,
}: {
  platform: StorePlatform;
  storeName: string;
  values: Record<string, string>;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/60 p-5">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring -ml-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-ink-3 transition-colors hover:text-brand-600"
        >
          <ArrowLeft size={15} /> Edit credentials
        </button>
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-brand-600">Review connection</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{storeName}</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        <div className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <StoreLogo platform={platform} />
          <div>
            <p className="text-sm font-bold text-ink">{platform.name}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink-3">
              {platform.category}
            </span>
          </div>
        </div>
        <dl className="divide-y divide-slate-100 rounded-glass-sm bg-white/60 px-4 ring-1 ring-slate-200/70">
          <ReviewRow label="Store name" value={storeName} />
          {platform.credentialFields.map((field) => (
            <ReviewRow
              key={field.key}
              label={field.label}
              value={field.type === 'password'
                ? '•'.repeat(Math.min(12, (values[field.key] ?? '').length || 8))
                : values[field.key] ?? '—'}
            />
          ))}
        </dl>
        <p className="flex items-start gap-2 rounded-glass-sm bg-brand-50/70 p-3 text-xs text-ink-3">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-600" />
          Credentials are submitted securely for operator review and are only used to sync this store's orders, inventory, and fulfillment once activated.
        </p>
      </div>
      <div className="flex items-center gap-3 border-t border-white/60 p-4">
        <Button type="button" variant="ghost" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button type="button" className="flex-1" onClick={onConfirm} leadingIcon={<Plus size={16} />}>
          Connect store
        </Button>
      </div>
    </div>
  );
}

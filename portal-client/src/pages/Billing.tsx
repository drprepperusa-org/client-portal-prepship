import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileBarChart, RefreshCw, Sparkles, Clock, Check } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useMe, useBillingStatus } from '@/lib/hooks';
import { portalApi } from '@/lib/api';
import { presetRange, type Preset } from '@/lib/dateRange';
import { cn } from '@/lib/cn';
import BillingClients from './Invoices';

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Billing — a single per-client summary with a printable Invoice per client
 *  and click-to-expand order line items, plus shared date range + Generate. */
export default function Billing() {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const isAdmin = useMe().data?.isAdmin ?? false;
  const billingStatus = useBillingStatus();
  const lastGen = billingStatus.data?.lastGenerated ?? null;

  // Shared date range drives the billing view and Generate. Custom dates are
  // staged in a draft first — the query only refires on "Apply range", never
  // on each individual date change (a half-picked range would otherwise load
  // immediately). Presets apply instantly since one click selects both dates.
  const initial = presetRange('90');
  const [preset, setPreset] = useState<Preset>('90');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const rangeDirty = draftFrom !== from || draftTo !== to;
  const rangeValid = Boolean(draftFrom) && Boolean(draftTo) && draftFrom <= draftTo;

  function applyPreset(p: Exclude<Preset, 'custom'>) {
    const r = presetRange(p);
    setPreset(p);
    setDraftFrom(r.from);
    setDraftTo(r.to);
    setFrom(r.from);
    setTo(r.to);
  }

  function applyRange() {
    if (!rangeValid) return;
    setFrom(draftFrom);
    setTo(draftTo);
  }

  function invalidateBilling() {
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['reports-range'] }),
      qc.invalidateQueries({ queryKey: ['invoice-details-range'] }),
      qc.invalidateQueries({ queryKey: ['billing-status'] }),
    ]);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await invalidateBilling();
      toast.success('Refreshed', 'Pulled the latest billing data.');
    } finally {
      window.setTimeout(() => setRefreshing(false), 500);
    }
  }

  async function generate() {
    if (!accessToken || generating) return;
    setGenerating(true);
    try {
      const res = await portalApi.generateBilling(accessToken, from, to);
      await invalidateBilling();
      toast.success('Billing generated', res.message || `Generated ${res.generated} line items.`);
    } catch (err) {
      toast.error('Generate failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Generate & summary controls (shared range + actions) */}
      <GlassPanel className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><FileBarChart size={13} /> Generate &amp; summary</p>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-ink-3 sm:inline-flex" title={lastGen?.at ? new Date(lastGen.at).toLocaleString() : undefined}>
              <Clock size={13} />
              Billing updated <span className="font-semibold text-ink-2">{timeAgo(lastGen?.at)}</span>
            </span>
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={15} className={cn(refreshing && 'animate-spin')} />} onClick={refresh}>Refresh</Button>
            {isAdmin && (
              <Button
                size="sm"
                leadingIcon={<Sparkles size={15} className={cn(generating && 'animate-pulse')} />}
                onClick={generate}
                disabled={generating || rangeDirty}
                title={rangeDirty ? 'Apply the date range first' : 'Recompute billing for the selected range now'}
              >
                {generating ? 'Updating…' : 'Update billing'}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker from={draftFrom} to={draftTo} preset={preset} onPreset={applyPreset} onFrom={(v) => { setDraftFrom(v); setPreset('custom'); }} onTo={(v) => { setDraftTo(v); setPreset('custom'); }} />
          {rangeDirty && (
            <Button size="sm" leadingIcon={<Check size={15} />} onClick={applyRange} disabled={!rangeValid} title={rangeValid ? 'Filter billing to this range' : 'Pick a start date on or before the end date'}>
              Apply range
            </Button>
          )}
        </div>
        {isAdmin && (
          <p className="text-[11px] text-ink-3">
            Billing updates automatically (the worker recomputes recent charges every 15 minutes and this page refreshes itself).
            “Update billing” forces a recompute for the selected range right now — idempotent, safe to re-run.
          </p>
        )}
      </GlassPanel>

      <BillingClients from={from} to={to} />
    </div>
  );
}

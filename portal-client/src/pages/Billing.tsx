import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileBarChart, RefreshCw, Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { useToast } from '@/components/ui/Toast';
import { useBillingStatus, useMe } from '@/lib/hooks';
import { useAuth } from '@/auth';
import { portalApi } from '@/lib/api';
import { presetRange, type Preset } from '@/lib/dateRange';
import BillingClients from './Invoices';

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unavailable';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Billing — per-client summary with a printable Invoice + Excel per client.
 *  Billing viewers may request canonical generation from PrepShip. Tenant
 *  scope stays backend-owned; the portal never calculates or persists truth. */
export default function Billing() {
  const toast = useToast();
  const qc = useQueryClient();
  const { accessToken } = useAuth();
  const me = useMe();
  const billingStatus = useBillingStatus();
  const canUpdateBilling = Boolean(me.data?.canViewFinancials);
  const lastGen = billingStatus.data?.lastGenerated ?? null;
  const billingStatusLabel = billingStatus.isLoading
    ? 'checking…'
    : billingStatus.isError
      ? 'unavailable'
      : timeAgo(lastGen?.at);

  // Shared date range drives the billing view. Custom dates are staged in a
  // draft first — the query only refires on "Apply range", never on each
  // individual date change. Presets apply instantly (one click = both dates).
  const initial = presetRange('90');
  const [preset, setPreset] = useState<Preset>('90');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [updating, setUpdating] = useState(false);

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
      qc.invalidateQueries({ queryKey: ['invoice-summary-range'] }),
      qc.invalidateQueries({ queryKey: ['invoice-period-summary-range'] }),
      qc.invalidateQueries({ queryKey: ['billing-status'] }),
    ]);
  }

  async function updateBilling() {
    if (!accessToken || !rangeValid || updating) return;
    setUpdating(true);
    try {
      const result = await portalApi.generateBilling(accessToken, draftFrom, draftTo);
      setFrom(draftFrom);
      setTo(draftTo);
      await invalidateBilling();
      toast.success('Billing updated', result.message);
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'The update is still taking too long. Check PrepShip Billing before retrying.'
          : error instanceof Error
            ? error.message
            : 'Please try again.';
      toast.error('Billing update failed', message);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary controls (shared range + canonical billing update) */}
      <GlassPanel className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><FileBarChart size={13} /> Billing summary</p>
          <div className="flex items-center gap-3">
            <span
              className="hidden items-center gap-1.5 text-xs text-ink-3 sm:inline-flex"
              title={!billingStatus.isError && lastGen?.at ? new Date(lastGen.at).toLocaleString() : undefined}
            >
              <Clock size={13} />
              Billing updated <span className="font-semibold text-ink-2">{billingStatusLabel}</span>
            </span>
            {billingStatus.isError && (
              <Button variant="secondary" size="sm" onClick={() => billingStatus.refetch()}>
                Retry status
              </Button>
            )}
            {canUpdateBilling && (
              <Button
                size="sm"
                loading={updating}
                disabled={!accessToken || !rangeValid}
                leadingIcon={<RefreshCw size={15} />}
                onClick={updateBilling}
                title={rangeValid ? 'Regenerate this date range using PrepShip Billing' : 'Choose a valid date range'}
              >
                Update Billing
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker from={draftFrom} to={draftTo} preset={preset} onPreset={applyPreset} onFrom={(v) => { setDraftFrom(v); setPreset('custom'); }} onTo={(v) => { setDraftTo(v); setPreset('custom'); }} />
          {rangeDirty && (
            <Button size="sm" onClick={applyRange} disabled={!rangeValid} title={rangeValid ? 'Filter billing to this range' : 'Pick a start date on or before the end date'}>
              Apply range
            </Button>
          )}
        </div>
        <p className="text-[11px] text-ink-3">
          Billing truth is generated by PrepShip. Update Billing regenerates only the clients assigned to your account; global admins update all clients.
        </p>
      </GlassPanel>

      <BillingClients from={from} to={to} />
    </div>
  );
}

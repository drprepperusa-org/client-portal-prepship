import { AlertTriangle, Loader2 } from 'lucide-react';
import type { BillingFinalizationCoverage } from '@client-portal-contracts/billing';
import { Button } from '@/components/ui/Button';

export type FinalizationView = 'checking' | 'open' | 'mixed' | 'unavailable' | 'closed';

/**
 * CP-070 — which banner the current request state allows. Display only: the verdict is PrepShip's
 * (GET /api/client-portal/billing/finalization-coverage); nothing here decides finality.
 *
 *   - An error is `unavailable`, even when an earlier answer is still cached.
 *   - While a request is pending a cached warning may stay (it is the safe side), but a cached
 *     `closed` is never presented as current: the view is `checking`.
 *   - An answer for other days than those applied, or an unknown status, is `unavailable`.
 */
export function finalizationView(input: {
  data: BillingFinalizationCoverage | undefined;
  isError: boolean;
  isFetching: boolean;
  from: string;
  to: string;
}): FinalizationView {
  if (input.isError) return 'unavailable';
  const { data } = input;
  if (!data) return 'checking';
  if (data.dateFrom !== input.from || data.dateTo !== input.to) return input.isFetching ? 'checking' : 'unavailable';
  const { status } = data;
  if (status !== 'open' && status !== 'mixed' && status !== 'closed' && status !== 'unavailable') return 'unavailable';
  if (input.isFetching && status !== 'open' && status !== 'mixed') return 'checking';
  return status;
}

export function BillingFinalizationBanner({
  view,
  onRetry,
  retrying = false,
}: {
  view: FinalizationView;
  onRetry: () => void;
  retrying?: boolean;
}) {
  if (view === 'closed') return null;
  if (view === 'checking') {
    return (
      <div
        role="status"
        data-testid="billing-finalization-banner"
        data-state="checking"
        className="flex items-center gap-2 rounded-glass-sm px-3 py-2 text-sm text-ink-3 ring-1 ring-black/5"
      >
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Checking billing finalization…
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="billing-finalization-banner"
      data-state={view}
      className="flex flex-wrap items-start gap-2 rounded-glass-sm bg-amber-50 px-3 py-3 text-sm text-amber-800 ring-1 ring-amber-200"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {view === 'open' && (
          <>
            <strong className="font-semibold">Billing not finalized</strong>
            {' — Charges for this period are preliminary and may change. Your final invoice will be available once DR PREPPER completes billing.'}
          </>
        )}
        {view === 'mixed' && 'This view includes unfinalized charges.'}
        {view === 'unavailable' && 'Unable to confirm billing finalization.'}
      </p>
      {view === 'unavailable' && (
        <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

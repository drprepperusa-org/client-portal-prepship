import { useState } from 'react';
import { Download } from 'lucide-react';
import { EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { apiText, defaultRange, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO_TOKEN } from '../lib/demo-data';
import { useBillingQuery } from '../lib/portalQueries';

export default function Invoices() {
  const auth = useAuth();
  const billing = useBillingQuery(auth.accessToken);
  const range = defaultRange();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busyClient, setBusyClient] = useState<number | null>(null);

  async function downloadInvoice(clientId: number | undefined) {
    if (!clientId || !auth.accessToken) return;
    setBusyClient(clientId);
    setDownloadError(null);
    const dateFrom = `${range.from}T00:00:00.000Z`;
    const dateTo = `${range.to}T23:59:59.999Z`;
    try {
      const html =
        auth.accessToken === DEMO_TOKEN
          ? `<h1>DrPrepperUSA Invoice</h1><p>Demo invoice for client ${clientId}</p>`
          : await apiText(auth.accessToken, '/billing/invoice', { clientId, dateFrom, dateTo });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        URL.revokeObjectURL(url);
        throw new Error('Your browser blocked the invoice window. Allow popups for this portal and try again.');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyClient(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Billing summaries are shown only when your PrepShip role has invoice visibility."
        action={<RefreshButton loading={billing.isFetching} onClick={() => void billing.refetch()} />}
      />
      {billing.error ? (
        <div className="mb-5">
          <ErrorPanel
            message={billing.error instanceof Error ? billing.error.message : String(billing.error)}
            loading={billing.isFetching}
            onRetry={() => void billing.refetch()}
          />
        </div>
      ) : null}
      {downloadError ? <div className="mb-5"><ErrorNotice message={downloadError} /></div> : null}
      <Panel title={`Billing window ${range.from} to ${range.to}`}>
        {billing.isLoading && !billing.data ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <div className="divide-y divide-line">
            {(billing.data?.data ?? []).map((row, index) => (
              <div key={row.clientId ?? index} className="grid gap-4 px-5 py-5 md:grid-cols-[1fr_repeat(3,0.7fr)_auto] md:items-center">
                <div>
                  <div className="text-sm font-black text-ink">{row.clientName ?? 'Client account'}</div>
                  <div className="mt-1 text-xs font-semibold text-ink-3">{safeNumber(row.orderCount)} billable orders</div>
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase text-ink-3">Pick/pack</div>
                  <div className="mt-1 text-sm font-black text-ink">{safeMoney(row.pickpackTotal)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase text-ink-3">Packages</div>
                  <div className="mt-1 text-sm font-black text-ink">{safeMoney(row.packageTotal)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-black uppercase text-ink-3">Total</div>
                  <div className="mt-1 text-sm font-black text-ink">{safeMoney(row.grandTotal)}</div>
                </div>
                {row.clientId ? (
                  <button type="button" onClick={() => void downloadInvoice(row.clientId)} disabled={busyClient === row.clientId} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-xs font-black text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none">
                    {busyClient === row.clientId ? 'Opening...' : 'Open invoice'} <Download size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {!billing.isLoading && (billing.data?.data.length ?? 0) === 0 ? <EmptyState title="No invoices available" body="If you expect invoices here, ask PrepShip to grant billing visibility to your portal account." /> : null}
      </Panel>
    </>
  );
}

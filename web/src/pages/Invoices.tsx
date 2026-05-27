import { useState } from 'react';
import { Download } from 'lucide-react';
import { EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { StoreBadge, storeNameForClient } from '../components/StoreScopeControls';
import { defaultRange, portalApi, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO_TOKEN } from '../lib/demo-data';
import { useBillingQuery, useClientsQuery, useMeQuery } from '../lib/portalQueries';
import type { PortalClient } from '../types/portal';

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: PortalClient[] }).data;
  return [];
}

export default function Invoices() {
  const auth = useAuth();
  const me = useMeQuery(auth.accessToken);
  const clients = useClientsQuery(auth.accessToken);
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
          : await portalApi.clientPortal.invoice(auth.accessToken, { clientId, dateFrom, dateTo });
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
        subtitle="Billing summaries are visible only for admin accounts or portal users explicitly granted billing visibility."
        action={<RefreshButton loading={billing.isFetching || me.isFetching} onClick={() => { void billing.refetch(); void me.refetch(); }} />}
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
      <Panel
        title="Assigned invoice scope"
        right={<span className="text-xs font-bold text-ink-3">{auth.user?.email ?? me.data?.email ?? 'Portal account'}</span>}
      >
        <div className="portal-owner-scope">
          {clientRows(clients.data).map((client) => (
            <StoreBadge key={client.id ?? client.name} name={client.name} />
          ))}
          {!clients.isLoading && clientRows(clients.data).length === 0 ? (
            <span className="text-sm font-semibold text-ink-3">Global admin visibility</span>
          ) : null}
        </div>
      </Panel>
      <div className="h-5" />
      <Panel title={`Billing window ${range.from} to ${range.to}`}>
        {billing.isLoading && !billing.data ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <div className="divide-y divide-line">
            {(billing.data?.data ?? []).map((row, index) => (
              <div key={row.clientId ?? index} className="grid gap-4 px-5 py-5 md:grid-cols-[1fr_repeat(3,0.7fr)_auto] md:items-center">
                <div>
                  <StoreBadge name={storeNameForClient(clientRows(clients.data), row.clientId, row.clientName)} />
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
        {!billing.isLoading && (billing.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title={me.data?.canViewFinancials ? 'No invoices available' : 'Invoice visibility not enabled'}
            body={
              me.data?.canViewFinancials
                ? 'No billable invoice rows were found for your current scoped stores in this billing window.'
                : 'This store-level account does not have billing visibility. An admin can grant financials:read when needed.'
            }
          />
        ) : null}
      </Panel>
    </>
  );
}

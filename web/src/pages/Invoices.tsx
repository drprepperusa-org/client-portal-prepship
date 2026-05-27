import { useState } from 'react';
import { CalendarDays, Download, RotateCcw } from 'lucide-react';
import { DataTable, EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { StoreBadge, storeNameForClient } from '../components/StoreScopeControls';
import { defaultRange, portalApi, safeDate, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO_TOKEN } from '../lib/demo-data';
import { useBillingQuery, useClientsQuery, useInvoiceDetailsQuery, useMeQuery } from '../lib/portalQueries';
import type { BillingInvoiceDetailRow, PortalClient } from '../types/portal';

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: PortalClient[] }).data;
  return [];
}

function pickPackTotal(row: { pickPackTotal?: number | string; pickpackTotal?: number | string }) {
  return row.pickPackTotal ?? row.pickpackTotal ?? 0;
}

export default function Invoices() {
  const initialRange = defaultRange();
  const [range, setRange] = useState(initialRange);
  const auth = useAuth();
  const me = useMeQuery(auth.accessToken);
  const clients = useClientsQuery(auth.accessToken);
  const billing = useBillingQuery(auth.accessToken, range);
  const invoiceDetails = useInvoiceDetailsQuery(auth.accessToken, range);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busyClient, setBusyClient] = useState<number | null>(null);

  function updateFrom(nextFrom: string) {
    setRange((current) => ({
      from: nextFrom,
      to: nextFrom > current.to ? nextFrom : current.to,
    }));
  }

  function updateTo(nextTo: string) {
    setRange((current) => ({
      from: nextTo < current.from ? nextTo : current.from,
      to: nextTo,
    }));
  }

  function resetRange() {
    setRange(defaultRange());
  }

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
        action={<RefreshButton loading={billing.isFetching || me.isFetching || invoiceDetails.isFetching} onClick={() => { void billing.refetch(); void me.refetch(); void invoiceDetails.refetch(); }} />}
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
      {invoiceDetails.error ? (
        <div className="mb-5">
          <ErrorPanel
            message={invoiceDetails.error instanceof Error ? invoiceDetails.error.message : String(invoiceDetails.error)}
            loading={invoiceDetails.isFetching}
            onRetry={() => void invoiceDetails.refetch()}
          />
        </div>
      ) : null}
      <Panel
        title="Invoice date range"
        right={<span className="text-xs font-bold text-ink-3">{range.from} to {range.to}</span>}
      >
        <div className="grid gap-3 p-4 md:grid-cols-[minmax(180px,220px)_minmax(180px,220px)_auto] md:items-end">
          <label className="block">
            <span className="flex items-center gap-2 text-[11px] font-black uppercase text-ink-3">
              <CalendarDays size={14} /> Start date
            </span>
            <div className="relative mt-1.5">
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(event) => updateFrom(event.target.value)}
                className="invoice-date-picker h-10 w-full rounded-lg border border-line bg-surface px-3 pr-9 text-sm font-black text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <CalendarDays className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" size={15} />
            </div>
          </label>
          <label className="block">
            <span className="flex items-center gap-2 text-[11px] font-black uppercase text-ink-3">
              <CalendarDays size={14} /> End date
            </span>
            <div className="relative mt-1.5">
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(event) => updateTo(event.target.value)}
                className="invoice-date-picker h-10 w-full rounded-lg border border-line bg-surface px-3 pr-9 text-sm font-black text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              <CalendarDays className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" size={15} />
            </div>
          </label>
          <button
            type="button"
            onClick={resetRange}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-black text-ink-2 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-bg hover:text-brand active:translate-y-0 motion-reduce:transform-none"
          >
            <RotateCcw size={15} /> Last 30 days
          </button>
        </div>
      </Panel>
      <div className="h-5" />
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
                  <div className="mt-1 text-sm font-black text-ink">{safeMoney(pickPackTotal(row))}</div>
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
      <div className="h-5" />
      <Panel
        title="Billable order details"
        right={<span className="text-xs font-bold text-ink-3">{safeNumber(invoiceDetails.data?.data.length ?? 0)} order row(s)</span>}
      >
        {invoiceDetails.isLoading && !invoiceDetails.data ? (
          <TableSkeleton rows={6} columns={8} />
        ) : (
          <DataTable<BillingInvoiceDetailRow>
            tableId="invoice-order-details-v2"
            rows={invoiceDetails.data?.data ?? []}
            getRowKey={(row) => `${row.clientId ?? 'client'}-${row.orderId ?? row.orderNumber ?? row.shipDate ?? 'row'}`}
            columns={[
              {
                key: 'client',
                header: 'Client',
                width: '190px',
                render: (row) => <StoreBadge name={storeNameForClient(clientRows(clients.data), row.clientId, row.clientName ?? undefined)} />,
              },
              {
                key: 'order',
                header: 'Order',
                width: '145px',
                render: (row) => <span className="font-black text-ink">{row.orderNumber ?? row.orderId ?? 'Unassigned'}</span>,
              },
              {
                key: 'recipient',
                header: 'Recipient',
                width: '190px',
                render: (row) => <span className="font-semibold text-ink-2">{row.recipientName ?? '-'}</span>,
              },
              {
                key: 'itemNames',
                header: 'Item name',
                width: '280px',
                render: (row) => <span className="line-clamp-2 font-semibold text-ink-2">{row.itemNames ?? '-'}</span>,
              },
              {
                key: 'shipDate',
                header: 'Ship date',
                width: '130px',
                render: (row) => <span className="font-semibold text-ink-2">{safeDate(row.shipDate)}</span>,
              },
              {
                key: 'qty',
                header: 'Qty',
                className: 'right',
                width: '90px',
                render: (row) => <span className="font-black tabular-nums text-ink">{safeNumber(row.qty)}</span>,
              },
              {
                key: 'pickpack',
                header: 'Pick/pack',
                className: 'right',
                width: '120px',
                render: (row) => <span className="font-semibold tabular-nums text-ink-2">{safeMoney(row.pickpackTotal)}</span>,
              },
              {
                key: 'packages',
                header: 'Packages',
                className: 'right',
                width: '120px',
                render: (row) => <span className="font-semibold tabular-nums text-ink-2">{safeMoney(row.packageTotal)}</span>,
              },
              {
                key: 'shipping',
                header: 'Shipping',
                className: 'right',
                width: '120px',
                render: (row) => <span className="font-semibold tabular-nums text-ink-2">{safeMoney(row.shippingTotal)}</span>,
              },
              {
                key: 'total',
                header: 'Total',
                className: 'right',
                width: '120px',
                render: (row) => <span className="font-black tabular-nums text-ink">{safeMoney(row.rowTotal)}</span>,
              },
            ]}
          />
        )}
        {!invoiceDetails.isLoading && (invoiceDetails.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title="No billable order details"
            body="Billable order rows will appear here when invoice line items exist for the current billing window."
          />
        ) : null}
      </Panel>
    </>
  );
}

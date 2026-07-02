import { useMemo, useState } from 'react';
import { Lock, ChevronLeft, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { EmptyState } from '@/components/ui/Display';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { CarrierBadge } from '@/components/store/CarrierBadge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useInvoiceDetailsRange, useInvoiceSummaryRange } from '@/lib/hooks';
import { portalApi, type BillingInvoiceDetailRow } from '@/lib/api';
import { exportInvoiceExcel } from '@/lib/invoiceExcel';
import { money, shortDate } from '@/lib/status';
import { cn } from '@/lib/cn';

const num = (v: unknown) => Number(v ?? 0) || 0;
const money0 = (n: number) => (n > 0 ? money(n) : '—');

type ClientSummary = {
  clientId: number;
  clientName: string;
  orders: number;
  pickpack: number;
  additional: number;
  box: number;
  storage: number;
  shipping: number;
  fee: number;
};

const moneyRight = 'text-right';
const actionBtn =
  'focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 ' +
  'transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50';
type BillingTotals = Omit<ClientSummary, 'clientId' | 'clientName'>;
const EMPTY_TOTALS: BillingTotals = {
  orders: 0,
  pickpack: 0,
  additional: 0,
  box: 0,
  storage: 0,
  shipping: 0,
  fee: 0,
};

function addBillingTotals(acc: BillingTotals, summary: ClientSummary): BillingTotals {
  return {
    orders: acc.orders + summary.orders,
    pickpack: acc.pickpack + summary.pickpack,
    additional: acc.additional + summary.additional,
    box: acc.box + summary.box,
    storage: acc.storage + summary.storage,
    shipping: acc.shipping + summary.shipping,
    fee: acc.fee + summary.fee,
  };
}

function InvoiceCarrierCell({ row }: { row: BillingInvoiceDetailRow }) {
  return row.carrierCode ? <CarrierBadge code={row.carrierCode} /> : <span className="text-ink-3">—</span>;
}

function InvoiceItemCell({ row }: { row: BillingInvoiceDetailRow }) {
  return (
    <span className="block whitespace-pre-line break-words text-ink-2" title={row.itemNames ?? ''}>
      {row.itemNames ?? row.recipientName ?? '—'}
    </span>
  );
}

export default function Invoices({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const { accessToken } = useAuth();
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [opening, setOpening] = useState<number | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);

  // Open the backend-rendered printable invoice for a client + range.
  async function viewInvoice(clientId?: number) {
    if (!clientId || !accessToken) {
      toast.error('Cannot open invoice', 'Missing client id.');
      return;
    }
    setOpening(clientId);
    try {
      const html = await portalApi.invoiceHtmlRange(accessToken, clientId, from, to);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) toast.warning('Pop-up blocked', 'Allow pop-ups to view the invoice.');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error('Invoice failed', err instanceof Error ? err.message : 'Could not load the invoice.');
    } finally {
      setOpening(null);
    }
  }

  // Summary is aggregated in SQL server-side (no row cap), so order counts
  // and totals are exact regardless of how many billing lines the range has.
  const summaryQuery = useInvoiceSummaryRange(from, to);
  const billingVisible = summaryQuery.data?.billingVisible !== false;
  const summary: ClientSummary[] = useMemo(
    () =>
      (summaryQuery.data?.data ?? []).map((r) => ({
        clientId: r.clientId,
        clientName: r.clientName ?? `Client ${r.clientId}`,
        orders: r.orders,
        pickpack: num(r.pickpackTotal),
        additional: num(r.additionalTotal),
        box: num(r.packageTotal),
        storage: num(r.storageTotal),
        shipping: num(r.shippingTotal),
        fee: num(r.rowTotal),
      })),
    [summaryQuery.data],
  );
  const totals = useMemo(() => summary.reduce(addBillingTotals, EMPTY_TOTALS), [summary]);

  // Line items load per selected client, server-paginated (100/page) so the
  // animated table never renders thousands of rows at once.
  const detailQuery = useInvoiceDetailsRange(from, to, selectedClient, detailPage, 100);
  const lineItems = detailQuery.data?.data ?? [];
  const detailPg = detailQuery.data?.pagination;
  const selectedName = summary.find((s) => s.clientId === selectedClient)?.clientName ?? '';

  // Excel export fetches the client's full row set for the range directly,
  // so it is complete no matter which view the button was clicked from.
  async function exportExcel(clientId: number | null | undefined) {
    const id = Number(clientId);
    if (!Number.isFinite(id) || exporting != null || !accessToken) return;
    const clientName = summary.find((s) => s.clientId === id)?.clientName || `client-${id}`;
    setExporting(id);
    try {
      // Full (unpaginated) row set for the export, independent of table paging.
      const res = await portalApi.invoiceDetailsRange(accessToken, from, to, id, { pageSize: 5000 });
      const clientRows = res.data ?? [];
      if (!clientRows.length) {
        toast.error('Nothing to export', 'No billable lines for this client in range.');
        return;
      }
      await exportInvoiceExcel(clientRows, { clientName, from, to });
    } catch (err) {
      toast.error('Excel export failed', err instanceof Error ? err.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  const summaryCols: Column<ClientSummary>[] = [
    { key: 'client', header: 'Client', defaultWidth: 200, render: (s) => <span className="font-semibold text-brand-700">{s.clientName}</span>, sortAccessor: (s) => s.clientName },
    { key: 'orders', header: 'Orders', defaultWidth: 100, className: moneyRight, render: (s) => <span className="tnum text-ink-2">{s.orders.toLocaleString()}</span>, sortAccessor: (s) => s.orders },
    { key: 'pickpack', header: 'Pick & Pack', defaultWidth: 120, className: moneyRight, render: (s) => <span className="tnum text-ink-2">{money0(s.pickpack)}</span>, sortAccessor: (s) => s.pickpack },
    { key: 'addl', header: 'Addl Units', defaultWidth: 110, className: moneyRight, render: (s) => <span className="tnum text-ink-2">{money0(s.additional)}</span>, sortAccessor: (s) => s.additional },
    { key: 'box', header: 'Box Cost', defaultWidth: 110, className: moneyRight, render: (s) => <span className="tnum text-ink-2">{money0(s.box)}</span>, sortAccessor: (s) => s.box },
    { key: 'storage', header: 'Storage', defaultWidth: 110, className: moneyRight, render: (s) => <span className="tnum text-ink-2">{money0(s.storage)}</span>, sortAccessor: (s) => s.storage },
    { key: 'shipping', header: 'Shipping', defaultWidth: 120, className: moneyRight, render: (s) => <span className="tnum text-ink-2">{money0(s.shipping)}</span>, sortAccessor: (s) => s.shipping },
    { key: 'fee', header: 'Fulfillment Fee', defaultWidth: 140, className: moneyRight, render: (s) => <span className="font-bold tnum text-brand-700">{money(s.fee)}</span>, sortAccessor: (s) => s.fee },
    {
      key: 'invoice',
      header: '',
      defaultWidth: 200,
      draggable: false,
      resizable: false,
      className: 'text-right',
      render: (s) => (
        <span className="inline-flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); void exportExcel(s.clientId); }}
            disabled={exporting != null}
            className={actionBtn}
            title="Download line items as Excel (.xlsx)"
          >
            {exporting === s.clientId ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
            Excel
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); viewInvoice(s.clientId); }}
            className={actionBtn}
            title="Open printable invoice"
          >
            {opening === s.clientId ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            Invoice
          </button>
        </span>
      ),
    },
  ];

  const lineCols: Column<BillingInvoiceDetailRow>[] = useMemo(() => [
    { key: 'order', header: 'Order #', defaultWidth: 130, render: (r) => <span className="font-semibold text-brand-700">{r.orderNumber ?? (r.orderId ? `#${r.orderId}` : '—')}</span>, sortAccessor: (r) => r.orderNumber ?? '' },
    { key: 'date', header: 'Ship Date', defaultWidth: 120, render: (r) => <span className="tnum text-ink-3">{shortDate(r.shipDate)}</span>, sortAccessor: (r) => r.shipDate ?? '' },
    {
      key: 'carrier',
      header: 'Carrier',
      defaultWidth: 110,
      className: 'text-center',
      render: (r) => <InvoiceCarrierCell row={r} />,
      sortAccessor: (r) => r.carrierCode ?? '',
    },
    {
      key: 'item',
      header: 'Item Name',
      defaultWidth: 260,
      render: (r) => <InvoiceItemCell row={r} />,
      sortAccessor: (r) => r.itemNames ?? '',
    },
    { key: 'sku', header: 'SKU', defaultWidth: 130, render: (r) => <span className="block truncate font-mono text-xs text-ink-3" title={r.skus ?? ''}>{r.skus ?? '—'}</span>, sortAccessor: (r) => r.skus ?? '' },
    { key: 'qty', header: 'Qty', defaultWidth: 80, className: moneyRight, render: (r) => <span className="tnum">{num(r.qty)}</span>, sortAccessor: (r) => num(r.qty) },
    { key: 'pickpack', header: 'Pick & Pack', defaultWidth: 110, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.pickpackTotal))}</span>, sortAccessor: (r) => num(r.pickpackTotal) },
    { key: 'addl', header: 'Addl Units', defaultWidth: 100, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.additionalTotal))}</span>, sortAccessor: (r) => num(r.additionalTotal) },
    { key: 'boxcost', header: 'Box Cost', defaultWidth: 100, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.packageTotal))}</span>, sortAccessor: (r) => num(r.packageTotal) },
    { key: 'boxsize', header: 'Box Size', defaultWidth: 120, render: (r) => <span className="tnum text-ink-3">{r.boxSize ?? '—'}</span>, sortAccessor: (r) => r.boxSize ?? '' },
    { key: 'shipping', header: 'Shipping', defaultWidth: 110, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.shippingTotal))}</span>, sortAccessor: (r) => num(r.shippingTotal) },
    { key: 'fee', header: 'Fulfillment Fee', defaultWidth: 130, className: moneyRight, render: (r) => <span className="font-bold tnum text-brand-700">{money(num(r.rowTotal))}</span>, sortAccessor: (r) => num(r.rowTotal) },
  ], []);

  if (!billingVisible) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <EmptyState icon={<Lock size={24} />} title="Financials restricted" message="Your account doesn't have permission to view invoices." />
      </GlassPanel>
    );
  }

  const cell = 'px-4 py-3 text-right tnum';

  return (
    <div className="space-y-4">
      {selectedClient == null ? (
        <GlassPanel className="p-2 sm:p-3">
          <QueryState
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
            error={summaryQuery.error}
            isEmpty={summary.length === 0}
            onRetry={() => summaryQuery.refetch()}
            emptyTitle="No billing in this range"
            emptyMessage="Pick a different date range to see billable activity."
          >
            <DataTable
              tableId="invoices-summary"
              columns={summaryCols}
              rows={summary}
              rowKey={(s) => String(s.clientId)}
              onRowClick={(s) => { setSelectedClient(s.clientId); setDetailPage(1); }}
              defaultSort={{ key: 'fee', dir: 'desc' }}
              footer={
                <>
                  <td className="px-4 py-3">Total</td>
                  <td className={cell}>{totals.orders.toLocaleString()}</td>
                  <td className={cell}>{money(totals.pickpack)}</td>
                  <td className={cell}>{money(totals.additional)}</td>
                  <td className={cell}>{money0(totals.box)}</td>
                  <td className={cell}>{money0(totals.storage)}</td>
                  <td className={cell}>{money(totals.shipping)}</td>
                  <td className={cn(cell, 'text-brand-700')}>{money(totals.fee)}</td>
                  <td className="px-4 py-3" />
                </>
              }
            />
          </QueryState>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-3 px-2 pb-2">
            <button onClick={() => setSelectedClient(null)} className="focus-ring inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-glass-sm px-2 py-1 text-sm font-medium text-ink-2 hover:bg-slate-100">
              <ChevronLeft size={16} /> <span className="hidden sm:inline">All clients</span>
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">Line items — {selectedName}</p>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-xs text-ink-3 sm:inline">
                {(detailPg?.total ?? lineItems.length).toLocaleString()} line{(detailPg?.total ?? lineItems.length) === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => void exportExcel(selectedClient)}
                disabled={exporting != null || lineItems.length === 0}
                className={actionBtn}
                title="Download line items as Excel (.xlsx)"
              >
                {exporting === selectedClient ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
                Excel
              </button>
              <button
                onClick={() => viewInvoice(selectedClient ?? undefined)}
                className={actionBtn}
                title="Open printable invoice"
              >
                {opening === selectedClient ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                Invoice
              </button>
            </div>
          </div>
          <QueryState
            isLoading={detailQuery.isLoading}
            isError={detailQuery.isError}
            error={detailQuery.error}
            isEmpty={lineItems.length === 0}
            onRetry={() => detailQuery.refetch()}
            emptyTitle="No line items"
            emptyMessage="No billable lines for this client in range."
          >
            <DataTable
              tableId="invoices-lines"
              columns={lineCols}
              rows={lineItems}
              rowKey={(r) => `${r.orderId}-${r.orderNumber}`}
              defaultSort={{ key: 'date', dir: 'desc' }}
            />
            {detailPg && (
              <Pagination page={detailPg.page} totalPages={detailPg.totalPages} total={detailPg.total} pageSize={detailPg.pageSize} onPage={setDetailPage} />
            )}
          </QueryState>
        </GlassPanel>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ChevronLeft, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { GlassPanel } from '@/components/ui/Glass';
import { EmptyState, Chip } from '@/components/ui/Display';
import { QueryState } from '@/components/ui/QueryState';
import { Pagination } from '@/components/ui/Pagination';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { ItemNameLines, SkuLines } from '@/components/ItemIdentityLines';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useCanCustomizeTables, useClients, useInvoiceDetailsRange, useInvoicePeriodSummaryRange, useOrderShipments } from '@/lib/hooks';
import { portalApi, type BillingInvoiceDetailRow } from '@/lib/api';
import { fetchAllInvoiceRows as fetchAllInvoiceRowsPaged } from '@/lib/invoiceRows';
import { exportInvoiceExcel } from '@/lib/invoiceExcel';
import { money, shipmentStatusMeta, shortDate } from '@/lib/status';
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
  returnPostage: number;
  returnProcessing: number;
  fee: number;
};

const moneyRight = 'text-right';
const actionBtn =
  'focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 ' +
  'transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50';

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** One row per client per semi-monthly billing period (1st–15th / 16th–EOM). */
type PeriodSummary = ClientSummary & { periodStart: string; periodEnd: string };

/** 'YYYY-MM-DD' period bounds → 'Jul 1 – 15, 2026'. */
function periodLabel(start: string, end: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const month = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${d} – ${Number(end.slice(8, 10))}, ${y}`;
}

type BillingTotals = Omit<ClientSummary, 'clientId' | 'clientName'>;
const EMPTY_TOTALS: BillingTotals = {
  orders: 0,
  pickpack: 0,
  additional: 0,
  box: 0,
  storage: 0,
  shipping: 0,
  returnPostage: 0,
  returnProcessing: 0,
  fee: 0,
};

// Walk the paginated invoice-details endpoint via the shared helper so exports
// gather every line item without relying on the capped unpaginated route.
async function fetchAllInvoiceRows(
  token: string,
  clientId: number | undefined,
  rangeFrom: string,
  rangeTo: string,
): Promise<{ rows: BillingInvoiceDetailRow[]; truncated: boolean }> {
  return fetchAllInvoiceRowsPaged({
    fetcher: portalApi.invoiceDetailsRange,
    token,
    clientId,
    rangeFrom,
    rangeTo,
  });
}

export default function Invoices({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const { accessToken } = useAuth();
  const canCustomizeTables = useCanCustomizeTables();
  // Drill-in selection: a client + its semi-monthly billing period.
  const [selected, setSelected] = useState<{ clientId: number; clientName: string; from: string; to: string } | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  // CP-016: the Billing line-item table sorts across the FULL filtered set
  // (server-owned), not just the loaded page. This holds the active header sort;
  // a header click updates it + resets to page 1, and it flows into the query.
  const [detailSort, setDetailSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'date', dir: 'desc' });
  // Busy keys are `${clientId}-${periodStart}` so each period row spins alone.
  const [opening, setOpening] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  // CP-008: Billing Order # click opens the shipment-information drawer.
  // shippingTotal is the BILLED shipping from the clicked billing row — the
  // drawer shows that (matching the table), never the shipment record's
  // internal label cost, which would expose margin to clients.
  const [shipmentModal, setShipmentModal] = useState<{
    orderId: number;
    orderNumber: string | null;
    shippingTotal: number | string | null;
  } | null>(null);
  const orderShipmentsQuery = useOrderShipments(shipmentModal?.orderId ?? null);

  // Open the backend-rendered printable invoice for a client + billing period.
  async function viewInvoice(clientId: number | undefined, rangeFrom: string, rangeTo: string, busyKey: string) {
    if (!clientId || !accessToken) {
      toast.error('Cannot open invoice', 'Missing client id.');
      return;
    }
    setOpening(busyKey);
    try {
      const html = await portalApi.invoiceHtmlRange(accessToken, clientId, rangeFrom, rangeTo);
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

  // One row per client per billing period — semi-monthly halves by default,
  // or combined full months (May 1 – 31) via the toggle. Aggregated in SQL
  // server-side (no row cap) so counts and totals are exact. Admins can scope
  // the table to one client with the on-page filter (like Orders/Shipments).
  const [granularity, setGranularity] = useState<'half' | 'month'>('half');
  const clients = useClients().data?.data ?? [];
  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const summaryQuery = useInvoicePeriodSummaryRange(from, to, granularity, clientFilter);
  const billingDenied = summaryQuery.isError && errorStatus(summaryQuery.error) === 403;
  const billingVisible = summaryQuery.data?.billingVisible !== false && !billingDenied;
  const summary: PeriodSummary[] = useMemo(
    () =>
      (summaryQuery.data?.data ?? []).map((r) => ({
        clientId: r.clientId,
        clientName: r.clientName ?? `Client ${r.clientId}`,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        orders: r.orders,
        pickpack: num(r.pickpackTotal),
        additional: num(r.additionalTotal),
        box: num(r.packageTotal),
        storage: num(r.storageTotal),
        shipping: num(r.shippingTotal),
        returnPostage: num(r.returnPostageTotal),
        returnProcessing: num(r.returnProcessingTotal),
        fee: num(r.rowTotal),
      })),
    [summaryQuery.data],
  );
  // CP-011: the footer grand totals are backend-owned. Map the backend `totals`
  // object into the footer's field names — React does NOT reduce the per-period
  // rows (so the footer can't drift from the printable invoice / exports).
  const totals: BillingTotals = useMemo(() => {
    const t = summaryQuery.data?.totals;
    return t
      ? {
          orders: num(t.orders),
          pickpack: num(t.pickpackTotal),
          additional: num(t.additionalTotal),
          box: num(t.packageTotal),
          storage: num(t.storageTotal),
          shipping: num(t.shippingTotal),
          returnPostage: num(t.returnPostageTotal),
          returnProcessing: num(t.returnProcessingTotal),
          fee: num(t.rowTotal),
        }
      : EMPTY_TOTALS;
  }, [summaryQuery.data]);

  // Line items load for the selected client + billing period, server-paginated
  // (100/page) so the animated table never renders thousands of rows at once.
  const detailQuery = useInvoiceDetailsRange(selected?.from ?? from, selected?.to ?? to, selected?.clientId ?? null, detailPage, 100, detailSort?.key, detailSort?.dir);
  const lineItems = detailQuery.data?.data ?? [];
  const detailPg = detailQuery.data?.pagination;

  // Excel export fetches the full row set for the client + period (paging
  // through so nothing is truncated), independent of the table's paging.
  async function exportExcel(clientId: number, clientName: string, rangeFrom: string, rangeTo: string, busyKey: string) {
    if (exporting != null || !accessToken) return;
    setExporting(busyKey);
    try {
      const { rows, truncated } = await fetchAllInvoiceRows(accessToken, clientId, rangeFrom, rangeTo);
      if (!rows.length) {
        toast.error('Nothing to export', 'No billable lines for this client in this period.');
        return;
      }
      await exportInvoiceExcel(rows, { clientName, from: rangeFrom, to: rangeTo });
      if (truncated) toast.warning('Partial export', 'This range is very large; narrow it and export again for a complete file.');
    } catch (err) {
      toast.error('Excel export failed', err instanceof Error ? err.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  // Export the ENTIRE selected date range (every billing period) as one Excel —
  // the "I want April → July in a single file" case. Uses the on-page client
  // filter when set, else the whole visible scope with a Client column so a
  // multi-client file stays attributable.
  async function exportAllPeriods() {
    if (exporting != null || !accessToken) return;
    const distinctClientIds = [...new Set(summary.map((s) => s.clientId))];
    const effectiveClientId = clientFilter ?? (distinctClientIds.length === 1 ? distinctClientIds[0] : undefined);
    const multiClient = effectiveClientId == null && distinctClientIds.length > 1;
    const clientName = effectiveClientId != null
      ? summary.find((s) => s.clientId === effectiveClientId)?.clientName ?? `Client ${effectiveClientId}`
      : 'All clients';
    setExporting('all-periods');
    try {
      const { rows, truncated } = await fetchAllInvoiceRows(accessToken, effectiveClientId, from, to);
      if (!rows.length) {
        toast.error('Nothing to export', 'No billable lines in this date range.');
        return;
      }
      await exportInvoiceExcel(rows, { clientName, from, to, includeClient: multiClient });
      if (truncated) {
        toast.warning('Partial export', 'This range is very large; narrow it and export again for a complete file.');
      } else {
        toast.success('Excel ready', `${rows.length.toLocaleString()} line${rows.length === 1 ? '' : 's'} across ${from} → ${to}.`);
      }
    } catch (err) {
      toast.error('Excel export failed', err instanceof Error ? err.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  const summaryCols: Column<PeriodSummary>[] = [
    {
      key: 'period',
      header: 'Billing Period',
      defaultWidth: 150,
      render: (s) => <span className="tnum font-medium text-ink">{periodLabel(s.periodStart, s.periodEnd)}</span>,
      sortAccessor: (s) => s.periodStart,
      footer: '',
    },
    { key: 'client', header: 'Client', defaultWidth: 170, render: (s) => <span className="font-semibold text-brand-700">{s.clientName}</span>, sortAccessor: (s) => s.clientName, footer: 'Total' },
    {
      key: 'orders',
      header: 'Orders',
      defaultWidth: 100,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{s.orders.toLocaleString()}</span>,
      sortAccessor: (s) => s.orders,
      footer: <span className="tnum">{totals.orders.toLocaleString()}</span>,
    },
    {
      key: 'pickpack',
      header: 'Pick & Pack',
      defaultWidth: 120,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.pickpack)}</span>,
      sortAccessor: (s) => s.pickpack,
      footer: <span className="tnum">{money(totals.pickpack)}</span>,
    },
    {
      key: 'addl',
      header: 'Addl Units',
      defaultWidth: 110,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.additional)}</span>,
      sortAccessor: (s) => s.additional,
      footer: <span className="tnum">{money(totals.additional)}</span>,
    },
    {
      key: 'box',
      header: 'Box Charge',
      defaultWidth: 110,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.box)}</span>,
      sortAccessor: (s) => s.box,
      footer: <span className="tnum">{money0(totals.box)}</span>,
    },
    {
      key: 'shipping',
      header: 'Shipping',
      defaultWidth: 120,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.shipping)}</span>,
      sortAccessor: (s) => s.shipping,
      footer: <span className="tnum">{money(totals.shipping)}</span>,
    },
    {
      key: 'returnProcessing',
      header: 'Return Processing',
      defaultWidth: 140,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.returnProcessing)}</span>,
      sortAccessor: (s) => s.returnProcessing,
      footer: <span className="tnum">{money0(totals.returnProcessing)}</span>,
    },
    {
      key: 'returnPostage',
      header: 'Return Postage',
      defaultWidth: 130,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.returnPostage)}</span>,
      sortAccessor: (s) => s.returnPostage,
      footer: <span className="tnum">{money0(totals.returnPostage)}</span>,
    },
    {
      key: 'storage',
      header: 'Storage',
      defaultWidth: 110,
      className: moneyRight,
      render: (s) => <span className="tnum text-ink-2">{money0(s.storage)}</span>,
      sortAccessor: (s) => s.storage,
      footer: <span className="tnum">{money0(totals.storage)}</span>,
    },
    {
      key: 'fee',
      header: 'Fulfillment Fee',
      defaultWidth: 140,
      className: moneyRight,
      render: (s) => <span className="font-bold tnum text-brand-700">{money(s.fee)}</span>,
      sortAccessor: (s) => s.fee,
      footer: <span className="tnum text-brand-700">{money(totals.fee)}</span>,
    },
    {
      key: 'invoice',
      header: '',
      defaultWidth: 200,
      draggable: false,
      resizable: false,
      className: 'text-right',
      render: (s) => {
        const busyKey = `${s.clientId}-${s.periodStart}`;
        return (
          <span className="inline-flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); void exportExcel(s.clientId, s.clientName, s.periodStart, s.periodEnd, busyKey); }}
              disabled={exporting != null}
              className={actionBtn}
              title="Download this billing period as Excel (.xlsx)"
            >
              {exporting === busyKey ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
              Excel
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); viewInvoice(s.clientId, s.periodStart, s.periodEnd, busyKey); }}
              className={actionBtn}
              title="Open printable invoice for this billing period"
            >
              {opening === busyKey ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              Invoice
            </button>
          </span>
        );
      },
    },
  ];

  const lineCols: Column<BillingInvoiceDetailRow>[] = useMemo(() => [
    { key: 'date', header: 'Ship Date', defaultWidth: 120, render: (r) => <span className="tnum text-ink-3">{shortDate(r.shipDate)}</span>, sortAccessor: (r) => r.shipDate ?? '' },
    {
      key: 'order',
      header: 'Order #',
      defaultWidth: 130,
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            if (r.orderId != null) {
              setShipmentModal({
                orderId: Number(r.orderId),
                orderNumber: r.orderNumber ?? null,
                shippingTotal: r.shippingTotal ?? null,
              });
            }
          }}
          disabled={r.orderId == null}
          className="focus-ring cursor-pointer font-semibold text-brand-700 hover:underline disabled:cursor-default disabled:no-underline"
          title="View shipment information"
          aria-label={`View shipment information for order ${r.orderNumber ?? r.orderId ?? ''}`}
        >
          {r.orderNumber ?? (r.orderId ? `#${r.orderId}` : '—')}
        </button>
      ),
      sortAccessor: (r) => r.orderNumber ?? '',
    },
    {
      key: 'sku',
      header: 'SKU(s)',
      defaultWidth: 190,
      render: (r) =>
        r.items?.length ? (
          <SkuLines items={r.items} />
        ) : (
          <span className="whitespace-pre-line font-mono text-xs text-ink-3">{r.skus ?? r.itemNames ?? '—'}</span>
        ),
      sortAccessor: (r) => r.items?.[0]?.sku ?? r.skus ?? r.itemNames ?? '',
    },
    { key: 'qty', header: 'Qty', defaultWidth: 80, className: moneyRight, render: (r) => <span className="tnum">{num(r.qty)}</span>, sortAccessor: (r) => num(r.qty) },
    { key: 'pickpack', header: 'Pick & Pack', defaultWidth: 110, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.pickpackTotal))}</span>, sortAccessor: (r) => num(r.pickpackTotal) },
    { key: 'addl', header: 'Addl Units', defaultWidth: 100, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.additionalTotal))}</span>, sortAccessor: (r) => num(r.additionalTotal) },
    { key: 'boxcost', header: 'Box Charge', defaultWidth: 100, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.packageTotal))}</span>, sortAccessor: (r) => num(r.packageTotal) },
    { key: 'boxsize', header: 'Box Size', defaultWidth: 120, render: (r) => <span className="tnum text-ink-3">{r.boxSize ?? '—'}</span>, sortAccessor: (r) => r.boxSize ?? '' },
    { key: 'shipping', header: 'Shipping', defaultWidth: 110, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.shippingTotal))}</span>, sortAccessor: (r) => num(r.shippingTotal) },
    { key: 'storage', header: 'Storage', defaultWidth: 100, className: moneyRight, render: (r) => <span className="tnum text-ink-2">{money0(num(r.storageTotal))}</span>, sortAccessor: (r) => num(r.storageTotal) },
    {
      key: 'returnprocessing', header: 'Return Processing', defaultWidth: 140, className: moneyRight,
      render: (r) => <span className="tnum text-ink-2">{money0(num(r.returnProcessingTotal))}</span>,
      sortAccessor: (r) => num(r.returnProcessingTotal),
    },
    {
      key: 'returnpostage', header: 'Return Postage', defaultWidth: 130, className: moneyRight,
      render: (r) => <span className="tnum text-ink-2">{money0(num(r.returnPostageTotal))}</span>,
      sortAccessor: (r) => num(r.returnPostageTotal),
    },
    { key: 'fee', header: 'Fulfillment Fee', defaultWidth: 130, className: moneyRight, render: (r) => <span className="font-bold tnum text-brand-700">{money(num(r.rowTotal))}</span>, sortAccessor: (r) => num(r.rowTotal) },
  ], []);

  if (!billingVisible) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <EmptyState
          icon={<FileText size={24} />}
          title="No billing available"
          message="Billing is not available for this account yet."
        />
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-4">
      {selected == null ? (
        <GlassPanel className="p-2 sm:p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
            <p className="text-sm font-bold text-ink">Billing periods</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {clients.length > 1 && (
                <select
                  value={clientFilter ?? ''}
                  onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : undefined)}
                  aria-label="Filter billing periods by client"
                  className="focus-ring mr-1.5 h-8 cursor-pointer appearance-none rounded-glass-sm border border-white/80 bg-white/60 px-2.5 pr-7 text-xs font-medium text-ink ring-1 ring-slate-200/70 focus:bg-white/90"
                >
                  <option value="">All clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? `Client ${c.id}`}</option>
                  ))}
                </select>
              )}
              {([['half', 'Semi-Monthly'], ['month', 'Monthly']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setGranularity(value)}
                  className={cn(
                    'focus-ring cursor-pointer rounded-glass-sm px-3 py-1.5 text-xs font-semibold transition-colors',
                    granularity === value
                      ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass'
                      : 'bg-white/60 text-ink-2 ring-1 ring-slate-200/70 hover:bg-white',
                  )}
                >
                  {label}
                </button>
              ))}
              {/* Export EVERY period in the selected range as one Excel — the
                  per-row buttons only cover a single period each. */}
              <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
              <button
                onClick={() => void exportAllPeriods()}
                disabled={exporting != null || summary.length === 0}
                className={actionBtn}
                title={`Download every billing period from ${from} to ${to} in one Excel (.xlsx)`}
              >
                {exporting === 'all-periods' ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
                Export all
              </button>
            </div>
          </div>
          <QueryState
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
            error={summaryQuery.error}
            isEmpty={summary.length === 0}
            onRetry={() => summaryQuery.refetch()}
            emptyTitle="No billing available"
            emptyMessage="There are no billing periods available for this date range."
          >
            <DataTable
              tableId="invoices-summary"
              columns={summaryCols}
              rows={summary}
              rowKey={(s) => `${s.clientId}-${s.periodStart}`}
              allowColumnCustomization={canCustomizeTables}
              onRowClick={(s) => {
                setSelected({ clientId: s.clientId, clientName: s.clientName, from: s.periodStart, to: s.periodEnd });
                setDetailPage(1);
              }}
              defaultSort={{ key: 'period', dir: 'desc' }}
            />
          </QueryState>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-3 px-2 pb-2">
            <button onClick={() => setSelected(null)} className="focus-ring inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-glass-sm px-2 py-1 text-sm font-medium text-ink-2 hover:bg-slate-100">
              <ChevronLeft size={16} /> <span className="hidden sm:inline">All periods</span>
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">
              Line items — {selected.clientName} · {periodLabel(selected.from, selected.to)}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-xs text-ink-3 sm:inline">
                {(detailPg?.total ?? lineItems.length).toLocaleString()} line{(detailPg?.total ?? lineItems.length) === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => void exportExcel(selected.clientId, selected.clientName, selected.from, selected.to, `${selected.clientId}-${selected.from}`)}
                disabled={exporting != null || lineItems.length === 0}
                className={actionBtn}
                title="Download this billing period as Excel (.xlsx)"
              >
                {exporting === `${selected.clientId}-${selected.from}` ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
                Excel
              </button>
              <button
                onClick={() => viewInvoice(selected.clientId, selected.from, selected.to, `${selected.clientId}-${selected.from}`)}
                className={actionBtn}
                title="Open printable invoice for this billing period"
              >
                {opening === `${selected.clientId}-${selected.from}` ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
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
            emptyMessage="No billable lines for this client in this billing period."
          >
            <DataTable
              tableId="invoices-lines"
              columns={lineCols}
              rows={lineItems}
              rowKey={(r) => `${r.orderId}-${r.orderNumber}`}
              allowColumnCustomization={canCustomizeTables}
              sort={detailSort}
              onSortChange={(s) => { setDetailSort(s); setDetailPage(1); }}
            />
            {detailPg && (
              <Pagination page={detailPg.page} totalPages={detailPg.totalPages} total={detailPg.total} pageSize={detailPg.pageSize} onPage={setDetailPage} />
            )}
          </QueryState>
        </GlassPanel>
      )}

      <Drawer
        open={!!shipmentModal}
        onClose={() => setShipmentModal(null)}
        title={shipmentModal ? `Shipments — Order ${shipmentModal.orderNumber ?? `#${shipmentModal.orderId}`}` : ''}
      >
        {shipmentModal && (
          <div className="space-y-4">
          {shipmentModal.shippingTotal != null && Number(shipmentModal.shippingTotal) > 0 && (
            <ShipmentField label="Shipping (billed)" value={money(shipmentModal.shippingTotal)} />
          )}
          <QueryState
            isLoading={orderShipmentsQuery.isLoading}
            isError={orderShipmentsQuery.isError}
            error={orderShipmentsQuery.error}
            isEmpty={(orderShipmentsQuery.data?.data ?? []).length === 0}
            onRetry={() => orderShipmentsQuery.refetch()}
            emptyTitle="No shipment yet"
            emptyMessage="No shipment record found for this billing line."
          >
            <div className="space-y-4">
              {(orderShipmentsQuery.data?.data ?? []).map((s) => (
                <div key={s.id} className="space-y-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
                  <div className="flex items-center justify-between">
                    <Chip accent={shipmentStatusMeta(s).accent}>{shipmentStatusMeta(s).label}</Chip>
                    <span className="text-xs text-ink-3">Shipment #{s.id}</span>
                  </div>
                  <div className="rounded-glass-sm bg-white/70 p-3 ring-1 ring-slate-200/70">
                    <p className="text-xs text-ink-3">Tracking number</p>
                    <p className="truncate font-mono text-sm text-ink">{s.trackingNumber ?? s.labelTracking ?? '—'}</p>
                  </div>
                  {/* CP-009: no Carrier / Service — customer-facing shipment info only. */}
                  <div className="grid grid-cols-2 gap-3">
                    <ShipmentField label="Ship date" value={shortDate(s.shipDate)} />
                    <ShipmentField label="Delivered" value={s.deliveredAt ? shortDate(s.deliveredAt) : '—'} />
                  </div>
                  {(s.items?.length ?? 0) > 0 && (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.5fr)]">
                      <ItemNameLines items={s.items} limit={6} />
                      <SkuLines items={s.items} limit={6} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </QueryState>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function ShipmentField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ChevronLeft, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useAuth } from '@/auth';
import {
  InvoiceShipmentDrawer,
  type InvoiceShipmentSelection,
} from '@/components/billing/InvoiceShipmentDrawer';
import {
  buildInvoiceLineColumns,
  buildSummaryColumns,
  EMPTY_BILLING_TOTALS,
  invoiceActionButtonClass,
  numberValue,
  periodLabel,
  type BillingTotals,
  type PeriodSummary,
} from '@/components/billing/invoiceColumns';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/Display';
import { GlassPanel } from '@/components/ui/Glass';
import { Pagination } from '@/components/ui/Pagination';
import { QueryState } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  useCanCustomizeTables,
  useClients,
  useInvoiceDetailsRange,
  useInvoicePeriodSummaryRange,
} from '@/lib/hooks';
import { portalApi, type BillingInvoiceDetailRow } from '@/lib/api';
import { exportInvoiceExcel } from '@/lib/invoiceExcel';
import { fetchAllInvoiceRows as fetchAllInvoiceRowsPaged } from '@/lib/invoiceRows';

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

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
  const [selected, setSelected] = useState<{
    clientId: number;
    clientName: string;
    from: string;
    to: string;
  } | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  // CP-016: line-item sorting remains server-owned across the full filtered set.
  const [detailSort, setDetailSort] = useState<{
    key: string;
    dir: 'asc' | 'desc';
  } | null>({ key: 'date', dir: 'desc' });
  const [opening, setOpening] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  // CP-008: the drawer receives billed shipping from the selected billing row.
  // It never substitutes the shipment record's internal label cost.
  const [shipmentModal, setShipmentModal] = useState<InvoiceShipmentSelection | null>(null);
  const [granularity, setGranularity] = useState<'half' | 'month'>('half');
  const [clientFilter, setClientFilter] = useState<number | undefined>();

  const clients = useClients().data?.data ?? [];
  const summaryQuery = useInvoicePeriodSummaryRange(from, to, granularity, clientFilter);
  const billingDenied = summaryQuery.isError && errorStatus(summaryQuery.error) === 403;
  const billingVisible = summaryQuery.data?.billingVisible !== false && !billingDenied;
  const summary: PeriodSummary[] = useMemo(
    () =>
      (summaryQuery.data?.data ?? []).map((row) => ({
        clientId: row.clientId,
        clientName: row.clientName ?? `Client ${row.clientId}`,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        orders: row.orders,
        pickpack: numberValue(row.pickpackTotal),
        additional: numberValue(row.additionalTotal),
        box: numberValue(row.packageTotal),
        storage: numberValue(row.storageTotal),
        shipping: numberValue(row.shippingTotal),
        returnPostage: numberValue(row.returnPostageTotal),
        returnProcessing: numberValue(row.returnProcessingTotal),
        fee: numberValue(row.rowTotal),
      })),
    [summaryQuery.data],
  );

  // CP-011: footer totals map the backend `totals` DTO. React never reduces
  // period rows, so this surface cannot drift from printable invoices/exports.
  const totals: BillingTotals = useMemo(() => {
    const value = summaryQuery.data?.totals;
    return value
      ? {
          orders: numberValue(value.orders),
          pickpack: numberValue(value.pickpackTotal),
          additional: numberValue(value.additionalTotal),
          box: numberValue(value.packageTotal),
          storage: numberValue(value.storageTotal),
          shipping: numberValue(value.shippingTotal),
          returnPostage: numberValue(value.returnPostageTotal),
          returnProcessing: numberValue(value.returnProcessingTotal),
          fee: numberValue(value.rowTotal),
        }
      : EMPTY_BILLING_TOTALS;
  }, [summaryQuery.data]);

  const detailQuery = useInvoiceDetailsRange(
    selected?.from ?? from,
    selected?.to ?? to,
    selected?.clientId ?? null,
    detailPage,
    100,
    detailSort?.key,
    detailSort?.dir,
  );
  const lineItems = detailQuery.data?.data ?? [];
  const detailPagination = detailQuery.data?.pagination;

  async function viewInvoice(
    clientId: number | undefined,
    rangeFrom: string,
    rangeTo: string,
    busyKey: string,
  ) {
    if (!clientId || !accessToken) {
      toast.error('Cannot open invoice', 'Missing client id.');
      return;
    }
    setOpening(busyKey);
    try {
      const html = await portalApi.invoiceHtmlRange(accessToken, clientId, rangeFrom, rangeTo);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (!window.open(url, '_blank')) {
        toast.warning('Pop-up blocked', 'Allow pop-ups to view the invoice.');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error('Invoice failed', error instanceof Error ? error.message : 'Could not load the invoice.');
    } finally {
      setOpening(null);
    }
  }

  async function exportExcel(
    clientId: number,
    clientName: string,
    rangeFrom: string,
    rangeTo: string,
    busyKey: string,
  ) {
    if (exporting != null || !accessToken) return;
    setExporting(busyKey);
    try {
      const result = await fetchAllInvoiceRows(accessToken, clientId, rangeFrom, rangeTo);
      if (!result.rows.length) {
        toast.error('Nothing to export', 'No billable lines for this client in this period.');
        return;
      }
      await exportInvoiceExcel(result.rows, { clientName, from: rangeFrom, to: rangeTo });
      if (result.truncated) {
        toast.warning('Partial export', 'This range is very large; narrow it for a complete file.');
      }
    } catch (error) {
      toast.error('Excel export failed', error instanceof Error ? error.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  async function exportAllPeriods() {
    if (exporting != null || !accessToken) return;
    const clientIds = [...new Set(summary.map((row) => row.clientId))];
    const clientId = clientFilter ?? (clientIds.length === 1 ? clientIds[0] : undefined);
    const multiClient = clientId == null && clientIds.length > 1;
    const clientName = clientId == null
      ? 'All clients'
      : summary.find((row) => row.clientId === clientId)?.clientName ?? `Client ${clientId}`;
    setExporting('all-periods');
    try {
      const result = await fetchAllInvoiceRows(accessToken, clientId, from, to);
      if (!result.rows.length) {
        toast.error('Nothing to export', 'No billable lines in this date range.');
        return;
      }
      await exportInvoiceExcel(result.rows, { clientName, from, to, includeClient: multiClient });
      if (result.truncated) {
        toast.warning('Partial export', 'This range is very large; narrow it for a complete file.');
      } else {
        toast.success('Excel ready', `${result.rows.length.toLocaleString()} lines across ${from} → ${to}.`);
      }
    } catch (error) {
      toast.error('Excel export failed', error instanceof Error ? error.message : 'Could not build the Excel file.');
    } finally {
      setExporting(null);
    }
  }

  const summaryColumns = buildSummaryColumns({
    totals,
    exporting,
    opening,
    onExport: (row, key) => {
      void exportExcel(row.clientId, row.clientName, row.periodStart, row.periodEnd, key);
    },
    onView: (row, key) => {
      void viewInvoice(row.clientId, row.periodStart, row.periodEnd, key);
    },
  });
  const lineColumns = useMemo(() => buildInvoiceLineColumns(setShipmentModal), []);

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
                  onChange={(event) => setClientFilter(
                    event.target.value ? Number(event.target.value) : undefined,
                  )}
                  aria-label="Filter billing periods by client"
                  className={cn(
                    'focus-ring mr-1.5 h-11 cursor-pointer appearance-none rounded-glass-sm',
                    'border border-white/80 bg-white/60 px-2.5 pr-7 text-xs font-medium text-ink',
                    'ring-1 ring-slate-200/70 focus:bg-white/90 sm:h-8',
                  )}
                >
                  <option value="">All clients</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name ?? `Client ${client.id}`}</option>
                  ))}
                </select>
              )}
              {([['half', 'Semi-Monthly'], ['month', 'Monthly']] as const).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setGranularity(value)}
                  className={cn(
                    'focus-ring min-h-11 cursor-pointer rounded-glass-sm px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-8',
                    granularity === value
                      ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass'
                      : 'bg-white/60 text-ink-2 ring-1 ring-slate-200/70 hover:bg-white',
                  )}
                >
                  {label}
                </button>
              ))}
              <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
              <button
                type="button"
                onClick={() => void exportAllPeriods()}
                disabled={exporting != null || summary.length === 0}
                className={invoiceActionButtonClass}
                title={`Download every billing period from ${from} to ${to} in one Excel (.xlsx)`}
              >
                {exporting === 'all-periods'
                  ? <Loader2 size={13} className="animate-spin" />
                  : <FileSpreadsheet size={13} />}
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
              columns={summaryColumns}
              rows={summary}
              rowKey={(row) => `${row.clientId}-${row.periodStart}`}
              allowColumnCustomization={canCustomizeTables}
              onRowClick={(row) => {
                setSelected({
                  clientId: row.clientId,
                  clientName: row.clientName,
                  from: row.periodStart,
                  to: row.periodEnd,
                });
                setDetailPage(1);
              }}
              rowActionLabel={(row) =>
                `View billing details for ${row.clientName}, ${periodLabel(row.periodStart, row.periodEnd)}`}
              defaultSort={{ key: 'period', dir: 'desc' }}
            />
          </QueryState>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-2 sm:p-3">
          <div className="flex items-center justify-between gap-3 px-2 pb-2">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="focus-ring inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-glass-sm px-2 py-1 text-sm font-medium text-ink-2 hover:bg-slate-100 sm:min-h-8"
            >
              <ChevronLeft size={16} /> <span className="hidden sm:inline">All periods</span>
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">
              Line items — {selected.clientName} · {periodLabel(selected.from, selected.to)}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-xs text-ink-3 sm:inline">
                {(detailPagination?.total ?? lineItems.length).toLocaleString()} lines
              </span>
              <button
                type="button"
                onClick={() => void exportExcel(selected.clientId, selected.clientName, selected.from, selected.to, `${selected.clientId}-${selected.from}`)}
                disabled={exporting != null || lineItems.length === 0}
                className={invoiceActionButtonClass}
                title="Download this billing period as Excel (.xlsx)"
              >
                <FileSpreadsheet size={13} /> Excel
              </button>
              <button
                type="button"
                onClick={() => void viewInvoice(selected.clientId, selected.from, selected.to, `${selected.clientId}-${selected.from}`)}
                className={invoiceActionButtonClass}
                title="Open printable invoice for this billing period"
              >
                <FileText size={13} /> Invoice
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
              columns={lineColumns}
              rows={lineItems}
              rowKey={(row) => `${row.orderId}-${row.orderNumber}`}
              allowColumnCustomization={canCustomizeTables}
              sort={detailSort}
              onSortChange={(sort) => {
                setDetailSort(sort);
                setDetailPage(1);
              }}
            />
            {detailPagination && (
              <Pagination
                page={detailPagination.page}
                totalPages={detailPagination.totalPages}
                total={detailPagination.total}
                pageSize={detailPagination.pageSize}
                onPage={setDetailPage}
              />
            )}
          </QueryState>
        </GlassPanel>
      )}
      <InvoiceShipmentDrawer selection={shipmentModal} onClose={() => setShipmentModal(null)} />
    </div>
  );
}

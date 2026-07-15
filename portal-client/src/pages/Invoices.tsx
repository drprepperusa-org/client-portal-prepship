import { useCallback, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { useAuth } from '@/auth';
import {
  InvoiceShipmentDrawer,
  type InvoiceShipmentSelection,
} from '@/components/billing/InvoiceShipmentDrawer';
import { InvoiceLineItems } from '@/components/billing/invoices/InvoiceLineItems';
import { InvoicePeriodList } from '@/components/billing/invoices/InvoicePeriodList';
import {
  toBillingTotals,
  toPeriodSummaries,
} from '@/components/billing/invoices/invoicePresentation';
import type { InvoiceSelection, InvoiceSort } from '@/components/billing/invoices/types';
import { useInvoiceActions } from '@/components/billing/invoices/useInvoiceActions';
import type { BillingTotals, PeriodSummary } from '@/components/billing/invoiceColumns';
import { EmptyState } from '@/components/ui/Display';
import { GlassPanel } from '@/components/ui/Glass';
import {
  useCanCustomizeTables,
  useClients,
  useInvoiceDetailsRange,
  useInvoicePeriodSummaryRange,
} from '@/lib/hooks';

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

export default function Invoices({ from, to }: { from: string; to: string }) {
  const { accessToken } = useAuth();
  const canCustomizeTables = useCanCustomizeTables();
  const [selected, setSelected] = useState<InvoiceSelection | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(100);
  // CP-016: line-item sorting remains server-owned across the full filtered set.
  const [detailSort, setDetailSort] = useState<InvoiceSort>({ key: 'date', dir: 'desc' });
  // CP-008: billed shipping comes from the selected billing row, never label cost.
  const [shipmentModal, setShipmentModal] = useState<InvoiceShipmentSelection | null>(null);
  const [granularity, setGranularity] = useState<'half' | 'month'>('half');
  const [clientFilter, setClientFilter] = useState<number | undefined>();

  const clientsQuery = useClients();
  const clients = clientsQuery.data?.data ?? [];
  const summaryQuery = useInvoicePeriodSummaryRange(from, to, granularity, clientFilter);
  const billingDenied = summaryQuery.isError && errorStatus(summaryQuery.error) === 403;
  const billingVisible = summaryQuery.data?.billingVisible !== false && !billingDenied;
  const summary: PeriodSummary[] = useMemo(
    () => toPeriodSummaries(summaryQuery.data?.data ?? []),
    [summaryQuery.data],
  );
  // CP-011: footer totals map the backend `totals` DTO, never visible rows.
  const totals: BillingTotals = useMemo(
    () => toBillingTotals(summaryQuery.data?.totals),
    [summaryQuery.data],
  );

  // Line items load from the backend-owned, globally sorted page.
  const detailQuery = useInvoiceDetailsRange(
    selected?.from ?? from,
    selected?.to ?? to,
    selected?.clientId ?? null,
    detailPage,
    detailPageSize,
    detailSort?.key,
    detailSort?.dir,
  );
  const lineItems = detailQuery.data?.data ?? [];
  const actions = useInvoiceActions({ accessToken, summary, clientFilter, from, to });
  const handleShipmentSelect = useCallback((value: InvoiceShipmentSelection) => {
    setShipmentModal(value);
  }, []);

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

  const busyKey = selected ? `${selected.clientId}-${selected.from}` : '';
  return (
    <div className="space-y-4">
      {selected == null ? (
        <InvoicePeriodList
          clients={clients}
          clientFilter={clientFilter}
          granularity={granularity}
          summary={summary}
          totals={totals}
          from={from}
          to={to}
          exporting={actions.exporting}
          opening={actions.opening}
          canCustomizeTables={canCustomizeTables}
          isLoading={summaryQuery.isLoading || clientsQuery.isLoading}
          isError={summaryQuery.isError || clientsQuery.isError}
          error={summaryQuery.error}
          onRetry={() => { void Promise.all([summaryQuery.refetch(), clientsQuery.refetch()]); }}
          onClientFilterChange={setClientFilter}
          onGranularityChange={setGranularity}
          onSelect={(value) => { setSelected(value); setDetailPage(1); }}
          onExportAll={() => { void actions.exportAllPeriods(); }}
          onExport={(row, key) => {
            void actions.exportExcel(row.clientId, row.clientName, row.periodStart, row.periodEnd, key);
          }}
          onView={(row, key) => {
            void actions.viewInvoice(row.clientId, row.periodStart, row.periodEnd, key);
          }}
        />
      ) : (
        <InvoiceLineItems
          selected={selected}
          lineItems={lineItems}
          pagination={detailQuery.data?.pagination}
          sort={detailSort}
          exporting={actions.exporting}
          canCustomizeTables={canCustomizeTables}
          isLoading={detailQuery.isLoading}
          isError={detailQuery.isError}
          error={detailQuery.error}
          onRetry={() => { void detailQuery.refetch(); }}
          onBack={() => setSelected(null)}
          onPage={setDetailPage}
          onPageSize={(size) => { setDetailPageSize(size); setDetailPage(1); }}
          onSortChange={(sort) => { setDetailSort(sort); setDetailPage(1); }}
          onShipmentSelect={handleShipmentSelect}
          onExport={() => {
            void actions.exportExcel(selected.clientId, selected.clientName, selected.from, selected.to, busyKey);
          }}
          onView={() => {
            void actions.viewInvoice(selected.clientId, selected.from, selected.to, busyKey);
          }}
        />
      )}
      <InvoiceShipmentDrawer selection={shipmentModal} onClose={() => setShipmentModal(null)} />
    </div>
  );
}

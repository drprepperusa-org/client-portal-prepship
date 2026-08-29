import { useMemo } from 'react';
import { invoiceRowKey } from '@/lib/invoiceRows';
import { ChevronLeft, FileSpreadsheet, FileText } from 'lucide-react';
import type { InvoiceShipmentSelection } from '@/components/billing/InvoiceShipmentDrawer';
import { DataTable } from '@/components/ui/DataTable';
import { GlassPanel } from '@/components/ui/Glass';
import { Pagination } from '@/components/ui/Pagination';
import { QueryState } from '@/components/ui/QueryState';
import type { BillingInvoiceDetailRow } from '@/lib/api';
import {
  buildInvoiceLineColumns,
  invoiceActionButtonClass,
  periodLabel,
} from '../invoiceColumns';
import type { InvoicePagination, InvoiceSelection, InvoiceSort } from './types';

interface InvoiceLineItemsProps {
  selected: InvoiceSelection;
  lineItems: BillingInvoiceDetailRow[];
  pagination: InvoicePagination | undefined;
  sort: InvoiceSort;
  exporting: string | null;
  canCustomizeTables: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onBack: () => void;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  onSortChange: (sort: InvoiceSort) => void;
  onShipmentSelect: (selection: InvoiceShipmentSelection) => void;
  onExport: () => void;
  onView: () => void;
}

export function InvoiceLineItems(props: InvoiceLineItemsProps) {
  const lineColumns = useMemo(
    () => buildInvoiceLineColumns(props.onShipmentSelect),
    [props.onShipmentSelect],
  );

  return (
    <GlassPanel className="p-2 sm:p-3">
      <div className="flex items-center justify-between gap-3 px-2 pb-2">
        <button
          type="button"
          onClick={props.onBack}
          className="focus-ring inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-glass-sm px-2 py-1 text-sm font-medium text-ink-2 hover:bg-slate-100 sm:min-h-8"
        >
          <ChevronLeft size={16} /> <span className="hidden sm:inline">All periods</span>
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">
          Line items — {props.selected.clientName} · {periodLabel(props.selected.from, props.selected.to)}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-ink-3 sm:inline">
            {(props.pagination?.total ?? props.lineItems.length).toLocaleString()} lines
          </span>
          <button
            type="button"
            onClick={props.onExport}
            disabled={props.exporting != null || props.lineItems.length === 0}
            className={invoiceActionButtonClass}
            title="Download this billing period as Excel (.xlsx)"
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            type="button"
            onClick={props.onView}
            className={invoiceActionButtonClass}
            title="Open printable invoice for this billing period"
          >
            <FileText size={13} /> Invoice
          </button>
        </div>
      </div>
      <QueryState
        isLoading={props.isLoading}
        isError={props.isError}
        error={props.error}
        isEmpty={props.lineItems.length === 0}
        onRetry={props.onRetry}
        emptyTitle="No line items"
        emptyMessage="No billable lines for this client in this billing period."
      >
        <DataTable
          tableId="invoices-lines"
          columns={lineColumns}
          rows={props.lineItems}
          // CP-059: keyed on RELATIONAL EVENT identity, not the order.
          //
          // `${orderId}-${orderNumber}` was unique while every order produced one row. At event
          // grain an outbound and its returns all share that pair, so three rows arrived as key
          // "4242-4242" — React warns about duplicate keys and may duplicate or omit children,
          // which on a billing table means a customer sees the wrong money against the wrong
          // reference. The browser proof caught this as a console error.
          //
          // returnId is the discriminator because it is the relational fact. displayReference
          // is deliberately NOT used: it is a label, and two rows may legitimately share one.
          // CP-059: the backend-issued event identity, with NO fallback.
      //
      // The previous key was built from orderId/rowType/returnId, which is
      // `null-Outbound-none` for EVERY orderless storage line — React then treats several
      // distinct billing events as one row and reuses the wrong DOM node. The fallback that
      // shipped alongside the fix would have silently restored exactly that behaviour the
      // moment the identity went missing, which is how the projection defect stayed invisible.
      // The boundary now rejects any row without a valid identity, so there is nothing to fall
      // back to and no reason to pretend otherwise.
      rowKey={invoiceRowKey}
          allowColumnCustomization={props.canCustomizeTables}
          sort={props.sort}
          onSortChange={props.onSortChange}
        />
        {props.pagination && (
          <Pagination
            page={props.pagination.page}
            totalPages={props.pagination.totalPages}
            total={props.pagination.total}
            pageSize={props.pagination.pageSize}
            onPage={props.onPage}
            onPageSize={props.onPageSize}
          />
        )}
      </QueryState>
    </GlassPanel>
  );
}

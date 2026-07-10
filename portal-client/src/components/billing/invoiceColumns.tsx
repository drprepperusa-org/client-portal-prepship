import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { SkuLines } from '@/components/ItemIdentityLines';
import type { Column } from '@/components/ui/DataTable';
import type { BillingInvoiceDetailRow } from '@/lib/api';
import { money, shortDate } from '@/lib/status';
import type { InvoiceShipmentSelection } from './InvoiceShipmentDrawer';

export const invoiceActionButtonClass =
  'focus-ring inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 ' +
  'transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8';

const moneyRight = 'text-right';
export const numberValue = (value: unknown) => Number(value ?? 0) || 0;
const moneyOrDash = (value: number) => value > 0 ? money(value) : '—';

export type PeriodSummary = {
  clientId: number;
  clientName: string;
  periodStart: string;
  periodEnd: string;
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

export type BillingTotals = Omit<
  PeriodSummary,
  'clientId' | 'clientName' | 'periodStart' | 'periodEnd'
>;

export const EMPTY_BILLING_TOTALS: BillingTotals = {
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

export function periodLabel(start: string, end: string): string {
  const [year, month, day] = start.split('-').map(Number);
  const monthLabel = new Date(year, (month ?? 1) - 1, 1).toLocaleDateString(
    'en-US',
    { month: 'short' },
  );
  return `${monthLabel} ${day} – ${Number(end.slice(8, 10))}, ${year}`;
}

function moneyColumn(
  key: string,
  header: string,
  width: number,
  value: (row: PeriodSummary) => number,
  footerValue: number,
): Column<PeriodSummary> {
  return {
    key,
    header,
    defaultWidth: width,
    className: moneyRight,
    render: (row) => <span className="tnum text-ink-2">{moneyOrDash(value(row))}</span>,
    sortAccessor: value,
    footer: <span className="tnum">{moneyOrDash(footerValue)}</span>,
  };
}

export function buildSummaryColumns({
  totals,
  exporting,
  opening,
  onExport,
  onView,
}: {
  totals: BillingTotals;
  exporting: string | null;
  opening: string | null;
  onExport: (row: PeriodSummary, busyKey: string) => void;
  onView: (row: PeriodSummary, busyKey: string) => void;
}): Column<PeriodSummary>[] {
  return [
    {
      key: 'period',
      header: 'Billing Period',
      defaultWidth: 150,
      render: (row) => (
        <span className="tnum font-medium text-ink">
          {periodLabel(row.periodStart, row.periodEnd)}
        </span>
      ),
      sortAccessor: (row) => row.periodStart,
      footer: '',
    },
    {
      key: 'client',
      header: 'Client',
      defaultWidth: 170,
      render: (row) => <span className="font-semibold text-brand-700">{row.clientName}</span>,
      sortAccessor: (row) => row.clientName,
      footer: 'Total',
    },
    {
      key: 'orders',
      header: 'Orders',
      defaultWidth: 100,
      className: moneyRight,
      render: (row) => <span className="tnum text-ink-2">{row.orders.toLocaleString()}</span>,
      sortAccessor: (row) => row.orders,
      footer: <span className="tnum">{totals.orders.toLocaleString()}</span>,
    },
    moneyColumn('pickpack', 'Pick & Pack', 120, (row) => row.pickpack, totals.pickpack),
    moneyColumn('addl', 'Addl Units', 110, (row) => row.additional, totals.additional),
    moneyColumn('box', 'Box Charge', 110, (row) => row.box, totals.box),
    moneyColumn('shipping', 'Shipping', 120, (row) => row.shipping, totals.shipping),
    moneyColumn(
      'returnProcessing',
      'Return Processing',
      140,
      (row) => row.returnProcessing,
      totals.returnProcessing,
    ),
    moneyColumn(
      'returnPostage',
      'Return Postage',
      130,
      (row) => row.returnPostage,
      totals.returnPostage,
    ),
    moneyColumn('storage', 'Storage', 110, (row) => row.storage, totals.storage),
    {
      key: 'fee',
      header: 'Fulfillment Fee',
      defaultWidth: 140,
      className: moneyRight,
      render: (row) => <span className="font-bold tnum text-brand-700">{money(row.fee)}</span>,
      sortAccessor: (row) => row.fee,
      footer: <span className="tnum text-brand-700">{money(totals.fee)}</span>,
    },
    {
      key: 'invoice',
      header: '',
      defaultWidth: 200,
      draggable: false,
      resizable: false,
      className: 'text-right',
      render: (row) => {
        const busyKey = `${row.clientId}-${row.periodStart}`;
        return (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onExport(row, busyKey);
              }}
              disabled={exporting != null}
              className={invoiceActionButtonClass}
              title="Download this billing period as Excel (.xlsx)"
            >
              {exporting === busyKey
                ? <Loader2 size={13} className="animate-spin" />
                : <FileSpreadsheet size={13} />}
              Excel
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onView(row, busyKey);
              }}
              className={invoiceActionButtonClass}
              title="Open printable invoice for this billing period"
            >
              {opening === busyKey
                ? <Loader2 size={13} className="animate-spin" />
                : <FileText size={13} />}
              Invoice
            </button>
          </span>
        );
      },
    },
  ];
}

function invoiceMoneyColumn(
  key: string,
  header: string,
  width: number,
  value: (row: BillingInvoiceDetailRow) => unknown,
): Column<BillingInvoiceDetailRow> {
  return {
    key,
    header,
    defaultWidth: width,
    className: moneyRight,
    render: (row) => (
      <span className="tnum text-ink-2">{moneyOrDash(numberValue(value(row)))}</span>
    ),
    sortAccessor: (row) => numberValue(value(row)),
  };
}

export function buildInvoiceLineColumns(
  onShipmentSelect: (selection: InvoiceShipmentSelection) => void,
): Column<BillingInvoiceDetailRow>[] {
  return [
    {
      key: 'date',
      header: 'Ship Date',
      defaultWidth: 120,
      render: (row) => <span className="tnum text-ink-3">{shortDate(row.shipDate)}</span>,
      sortAccessor: (row) => row.shipDate ?? '',
    },
    {
      key: 'order',
      header: 'Order #',
      defaultWidth: 130,
      render: (row) => (
        <button
          type="button"
          onClick={() => {
            if (row.orderId == null) return;
            onShipmentSelect({
              orderId: Number(row.orderId),
              orderNumber: row.orderNumber ?? null,
              shippingTotal: row.shippingTotal ?? null,
            });
          }}
          disabled={row.orderId == null}
          className="focus-ring min-h-11 cursor-pointer font-semibold text-brand-700 hover:underline disabled:cursor-default disabled:no-underline sm:min-h-8"
          title="View shipment information"
          aria-label={`View shipment information for order ${row.orderNumber ?? row.orderId ?? ''}`}
        >
          {row.orderNumber ?? (row.orderId ? `#${row.orderId}` : '—')}
        </button>
      ),
      sortAccessor: (row) => row.orderNumber ?? '',
    },
    {
      key: 'sku',
      header: 'SKU(s)',
      defaultWidth: 190,
      render: (row) => row.items?.length ? (
        <SkuLines items={row.items} />
      ) : (
        <span className="whitespace-pre-line font-mono text-xs text-ink-3">
          {row.skus ?? row.itemNames ?? '—'}
        </span>
      ),
      sortAccessor: (row) => row.items?.[0]?.sku ?? row.skus ?? row.itemNames ?? '',
    },
    {
      key: 'qty',
      header: 'Qty',
      defaultWidth: 80,
      className: moneyRight,
      render: (row) => <span className="tnum">{numberValue(row.qty)}</span>,
      sortAccessor: (row) => numberValue(row.qty),
    },
    invoiceMoneyColumn('pickpack', 'Pick & Pack', 110, (row) => row.pickpackTotal),
    invoiceMoneyColumn('addl', 'Addl Units', 100, (row) => row.additionalTotal),
    invoiceMoneyColumn('boxcost', 'Box Charge', 100, (row) => row.packageTotal),
    {
      key: 'boxsize',
      header: 'Box Size',
      defaultWidth: 120,
      render: (row) => <span className="tnum text-ink-3">{row.boxSize ?? '—'}</span>,
      sortAccessor: (row) => row.boxSize ?? '',
    },
    invoiceMoneyColumn('shipping', 'Shipping', 110, (row) => row.shippingTotal),
    invoiceMoneyColumn('storage', 'Storage', 100, (row) => row.storageTotal),
    invoiceMoneyColumn(
      'returnprocessing',
      'Return Processing',
      140,
      (row) => row.returnProcessingTotal,
    ),
    invoiceMoneyColumn(
      'returnpostage',
      'Return Postage',
      130,
      (row) => row.returnPostageTotal,
    ),
    {
      key: 'fee',
      header: 'Fulfillment Fee',
      defaultWidth: 130,
      className: moneyRight,
      render: (row) => (
        <span className="font-bold tnum text-brand-700">
          {money(numberValue(row.rowTotal))}
        </span>
      ),
      sortAccessor: (row) => numberValue(row.rowTotal),
    },
  ];
}

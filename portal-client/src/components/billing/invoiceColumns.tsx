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
      header: 'Billing Date',
      defaultWidth: 150,
      render: (row) => row.rolledFromWeekend ? (
        <span className="flex flex-col tnum leading-tight text-ink-3">
          <span>Billed {shortDate(row.billingEffectiveDate)}</span>
          <span className="text-[11px] text-ink-4">
            Fulfilled {shortDate(row.actualActivityDate ?? row.shipDate)}
          </span>
        </span>
      ) : (
        <span className="tnum text-ink-3">
          {shortDate(row.billingEffectiveDate ?? row.shipDate)}
        </span>
      ),
      sortAccessor: (row) => row.billingEffectiveDate ?? row.shipDate ?? '',
    },
    {
      key: 'order',
      header: 'Reference',
      defaultWidth: 150,
      // CP-059 AC-1. The reference is rendered VERBATIM from the backend — "1234",
      // "1234-RETURN", "1234-RETURN-2" — and never assembled here. The portal has no suffix
      // rule and must not acquire one: a locally minted "-RETURN" would be a second owner of
      // return identity, disagreeing with billing the moment upstream changes.
      //
      // Navigation keys on rowType, NOT on orderId. A Return shares its orderId with the
      // outbound, so routing by orderId opens the OUTBOUND shipment drawer from a Return —
      // showing a customer a different shipment's money. Returns stay non-clickable until a
      // dedicated return surface exists. Wrong navigation is worse than none.
      render: (row) => {
        const isReturn = row.rowType === 'Return';
        const label = row.displayReference
          ?? row.orderNumber
          ?? (row.orderId ? `#${row.orderId}` : '—');
        if (isReturn || row.orderId == null) {
          return (
            <span
              className="min-h-11 font-semibold text-ink-2 sm:min-h-8"
              title={isReturn ? 'Return activity for this order' : undefined}
            >
              {label}
            </span>
          );
        }
        return (
          <button
            type="button"
            onClick={() => {
              onShipmentSelect({
                orderId: Number(row.orderId),
                orderNumber: row.orderNumber ?? null,
                shippingTotal: row.shippingTotal ?? null,
              });
            }}
            className="focus-ring min-h-11 cursor-pointer font-semibold text-brand-700 hover:underline sm:min-h-8"
            title="View shipment information"
            aria-label={`View shipment information for order ${row.orderNumber ?? row.orderId ?? ''}`}
          >
            {label}
          </button>
        );
      },
      // Sorts the LABEL. Sorting cannot change which rows exist or how they group.
      sortAccessor: (row) => row.displayReference ?? row.orderNumber ?? '',
    },
    {
      key: 'rowType',
      header: 'Type',
      defaultWidth: 100,
      // Rendered as issued. The portal never infers Outbound vs Return from a reference
      // string, a line type, or the mere presence of return money.
      render: (row) => <span className="text-ink-2">{row.rowType ?? '—'}</span>,
      sortAccessor: (row) => row.rowType ?? '',
    },
    {
      key: 'destination',
      header: 'Destination',
      defaultWidth: 130,
      // CP-059 AC-2/AC-3. Backend classification ONLY — no country or territory comparison
      // here. PrepShip already normalises every US state, DC, APO/FPO/DPO and the territories
      // (PR/GU/VI/AS/MP/UM) to Domestic, and a Return inherits its OUTBOUND's classification
      // rather than the US address its parcel is physically travelling to.
      //
      // 'Needs Review' is a real value, not an error state. A column can say "we don't know",
      // and saying it beats guessing Domestic.
      render: (row) => <span className="text-ink-2">{row.destination ?? '—'}</span>,
      sortAccessor: (row) => row.destination ?? '',
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

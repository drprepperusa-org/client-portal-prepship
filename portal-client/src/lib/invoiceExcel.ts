import type { BillingInvoiceDetailRow } from '@/lib/api';
import { formatCarrierLabel } from '@/components/store/CarrierBadge';

// Excel (.xlsx) export for the per-client invoice line items. Column set and
// order mirror the billing line-items table (client-safe fields only — no
// selected rate / shipping margin):
//   Order # | Ship Date | Carrier | Item Name | SKU | Qty | Pick & Pack |
//   Addl Units | Box Cost | Box Size | Shipping | Storage | Fulfillment Fee
// Money cells are written as real numbers (2-decimal format) so Excel can sum
// and pivot them; the final row is a bold totals row. write-excel-file is
// loaded via dynamic import so the writer only ships when Export is clicked.

const num = (v: unknown) => Number(v ?? 0) || 0;
const MONEY_FORMAT = '#,##0.00';

const HEADERS = [
  'Order #',
  'Ship Date',
  'Carrier',
  'Item Name',
  'SKU',
  'Qty',
  'Pick & Pack',
  'Addl Units',
  'Box Cost',
  'Box Size',
  'Shipping',
  'Storage',
  'Fulfillment Fee',
] as const;

const COLUMN_WIDTHS = [10, 12, 10, 30, 26, 6, 12, 11, 10, 12, 10, 10, 14];

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'client';
}

export async function exportInvoiceExcel(
  rows: BillingInvoiceDetailRow[],
  opts: { clientName: string; from: string; to: string },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');

  const header = HEADERS.map((value) => ({ value: value as string, fontWeight: 'bold' as const }));

  const dataRows = rows.map((r) => [
    { type: String, value: r.orderNumber ?? (r.orderId != null ? `#${r.orderId}` : '') },
    { type: String, value: r.shipDate ?? '' },
    { type: String, value: r.carrierCode ? formatCarrierLabel(r.carrierCode) : '' },
    { type: String, value: r.itemNames ?? '', wrap: true },
    { type: String, value: r.skus ?? '', wrap: true },
    { type: Number, value: num(r.qty) },
    { type: Number, value: num(r.pickpackTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.additionalTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.packageTotal), format: MONEY_FORMAT },
    { type: String, value: r.boxSize ?? '' },
    { type: Number, value: num(r.shippingTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.storageTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.rowTotal), format: MONEY_FORMAT },
  ]);

  const sum = (pick: (r: BillingInvoiceDetailRow) => unknown) =>
    rows.reduce((acc, r) => acc + num(pick(r)), 0);
  const bold = { fontWeight: 'bold' as const };
  const totalsRow = [
    { type: String, value: 'Total', ...bold },
    null,
    null,
    null,
    null,
    { type: Number, value: sum((r) => r.qty), ...bold },
    { type: Number, value: sum((r) => r.pickpackTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.additionalTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.packageTotal), format: MONEY_FORMAT, ...bold },
    null,
    { type: Number, value: sum((r) => r.shippingTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.storageTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.rowTotal), format: MONEY_FORMAT, ...bold },
  ];

  await writeXlsxFile([header, ...dataRows, totalsRow], {
    columns: COLUMN_WIDTHS.map((width) => ({ width })),
    sheet: 'Invoice',
    fileName: `invoice-${slugify(opts.clientName)}-${opts.from}-${opts.to}.xlsx`,
  });
}

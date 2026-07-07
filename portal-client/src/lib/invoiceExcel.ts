import type { BillingInvoiceDetailRow } from '@/lib/api';

// Excel (.xlsx) export for the per-client invoice line items. Column set and
// order mirror the billing line-items table (client-safe fields only — no
// carrier / selected rate / shipping margin):
//   Ship Date | Order # | SKU(s) | Qty | Pick & Pack | Addl Units |
//   Box Charge | Box Size | Shipping | Storage | Return Processing |
//   Return Postage | Fulfillment Fee
// Money cells are written as real numbers (2-decimal format) so Excel can sum
// and pivot them; the final row is a bold totals row. write-excel-file is
// loaded via dynamic import so the writer only ships when Export is clicked.

const num = (v: unknown) => Number(v ?? 0) || 0;
const MONEY_FORMAT = '#,##0.00';

const HEADERS = [
  'Ship Date',
  'Order #',
  'SKU(s)',
  'Qty',
  'Pick & Pack',
  'Addl Units',
  'Box Charge',
  'Box Size',
  'Shipping',
  'Storage',
  'Return Processing',
  'Return Postage',
  'Fulfillment Fee',
] as const;

const COLUMN_WIDTHS = [12, 10, 28, 6, 12, 11, 10, 12, 10, 10, 15, 13, 14];

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'client';
}

export async function exportInvoiceExcel(
  rows: BillingInvoiceDetailRow[],
  opts: { clientName: string; from: string; to: string; includeClient?: boolean },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');

  // A whole-range export can span multiple clients (admin, no client filter);
  // prepend a Client column then so each line stays attributable.
  const includeClient = opts.includeClient ?? false;
  const clientCol = <T,>(cell: T) => (includeClient ? [cell] : []);

  const headerLabels = includeClient ? ['Client', ...HEADERS] : [...HEADERS];
  const widths = includeClient ? [22, ...COLUMN_WIDTHS] : COLUMN_WIDTHS;
  const header = headerLabels.map((value) => ({ value: value as string, fontWeight: 'bold' as const }));

  const dataRows = rows.map((r) => [
    ...clientCol({ type: String, value: r.clientName ?? '' }),
    { type: String, value: r.shipDate ?? '' },
    { type: String, value: r.orderNumber ?? (r.orderId != null ? `#${r.orderId}` : '') },
    { type: String, value: r.skus ?? r.itemNames ?? '', wrap: true },
    { type: Number, value: num(r.qty) },
    { type: Number, value: num(r.pickpackTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.additionalTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.packageTotal), format: MONEY_FORMAT },
    { type: String, value: r.boxSize ?? '' },
    { type: Number, value: num(r.shippingTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.storageTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.returnProcessingTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.returnPostageTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.rowTotal), format: MONEY_FORMAT },
  ]);

  const sum = (pick: (r: BillingInvoiceDetailRow) => unknown) =>
    rows.reduce((acc, r) => acc + num(pick(r)), 0);
  const bold = { fontWeight: 'bold' as const };
  const totalsRow = [
    ...clientCol(null),
    { type: String, value: 'Total', ...bold },
    null,
    null,
    { type: Number, value: sum((r) => r.qty), ...bold },
    { type: Number, value: sum((r) => r.pickpackTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.additionalTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.packageTotal), format: MONEY_FORMAT, ...bold },
    null,
    { type: Number, value: sum((r) => r.shippingTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.storageTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.returnProcessingTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.returnPostageTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.rowTotal), format: MONEY_FORMAT, ...bold },
  ];

  await writeXlsxFile([header, ...dataRows, totalsRow], {
    columns: widths.map((width) => ({ width })),
    sheet: 'Invoice',
    fileName: `invoice-${slugify(opts.clientName)}-${opts.from}-${opts.to}.xlsx`,
  });
}

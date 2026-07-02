import type { BillingInvoiceDetailRow } from '@/lib/api';

// Excel (.xlsx) export for the per-client invoice line items. Column set and
// order are fixed by the billing export spec:
//   Ship Date | SKU | Order # | Box Size | Box Cost | Qty | Pick & Pack Fee |
//   Additional Units | Shipping | Storage | Total
// Money cells are written as real numbers (2-decimal format) so Excel can sum
// and pivot them; the final row is a bold totals row. write-excel-file is
// loaded via dynamic import so the writer only ships when Export is clicked.

const num = (v: unknown) => Number(v ?? 0) || 0;
const MONEY_FORMAT = '#,##0.00';

const HEADERS = [
  'Ship Date',
  'SKU',
  'Order #',
  'Box Size',
  'Box Cost',
  'Qty',
  'Pick & Pack Fee',
  'Additional Units',
  'Shipping',
  'Storage',
  'Total',
] as const;

const COLUMN_WIDTHS = [12, 30, 12, 18, 10, 7, 15, 16, 10, 10, 11];

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
    { type: String, value: r.shipDate ?? '' },
    { type: String, value: r.skus ?? '', wrap: true },
    { type: String, value: r.orderNumber ?? (r.orderId != null ? `#${r.orderId}` : '') },
    { type: String, value: r.boxSize ?? '' },
    { type: Number, value: num(r.packageTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.qty) },
    { type: Number, value: num(r.pickpackTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.additionalTotal), format: MONEY_FORMAT },
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
    { type: Number, value: sum((r) => r.packageTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.qty), ...bold },
    { type: Number, value: sum((r) => r.pickpackTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.additionalTotal), format: MONEY_FORMAT, ...bold },
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

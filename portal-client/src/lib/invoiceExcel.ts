import type { BillingInvoiceDetailRow } from '@/lib/api';

// Excel (.xlsx) export for the per-client invoice line items. Column set and
// order mirror the billing line-items table (client-safe fields only — no
// carrier / selected rate / shipping margin):
//   Billing / Activity Date | Reference | Type | Destination | SKU(s) | Qty |
//   Pick & Pack | Addl Units | Box Charge | Box Size | Shipping | Storage |
//   Return Processing | Return Postage | Fulfillment Fee
// CP-059: this comment said "Order #" until the column-order guard passed on it while the
// real HEADERS array had already changed — the guard matches raw file text, so a stale
// comment kept it green. Keep this line in step with HEADERS below, or the guard is
// reading prose instead of the contract.
// Money cells are written as real numbers (2-decimal format) so Excel can sum
// and pivot them; the final row is a bold totals row. write-excel-file is
// loaded via dynamic import so the writer only ships when Export is clicked.

const num = (v: unknown) => Number(v ?? 0) || 0;
const MONEY_FORMAT = '#,##0.00';

/**
 * CP-059 AC-5 — a money cell that keeps "absent" distinct from "zero".
 *
 * `num()` collapses null to 0, which is correct for a column that is always billed and wrong
 * for return money, where "no return-postage line yet" and "a return-postage line of $0.00"
 * are different commercial facts. In a spreadsheet a fabricated 0.00 is indistinguishable
 * from a real one and will be summed, filtered and reconciled as though it were real.
 *
 * Presence is decided upstream (`hasReturn*Line`), never inferred from the amount.
 */
const moneyCellOrBlank = (present: boolean | null | undefined, value: unknown) =>
  present === true
    ? { type: Number, value: num(value), format: MONEY_FORMAT }
    : { type: String, value: '' };

const HEADERS = [
  'Billing / Activity Date',
  'Reference',
  'Type',
  'Destination',
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

const COLUMN_WIDTHS = [12, 14, 10, 13, 28, 6, 12, 11, 10, 12, 10, 10, 15, 13, 14];

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'client';
}

export type InvoiceExcelCell =
  | null
  | { type: typeof String; value: string; wrap?: boolean; fontWeight?: 'bold' }
  | { type: typeof Number; value: number; format?: string; fontWeight?: 'bold' }
  | { value: string; fontWeight: 'bold' };

/**
 * CP-059 — the sheet, built and returned rather than written.
 *
 * The download is a side effect; the CELLS are the contract. Keeping them in a pure function
 * means a guard can assert what an absent return line actually produces, instead of matching
 * the source text of the function that produces it. A regex over this file cannot tell the
 * difference between a blank cell and a fabricated 0.00 — running it can.
 */
export function buildInvoiceExcelSheet(
  rows: BillingInvoiceDetailRow[],
  opts: { includeClient?: boolean } = {},
): { sheet: InvoiceExcelCell[][]; widths: number[] } {
  // A whole-range export can span multiple clients (admin, no client filter);
  // prepend a Client column then so each line stays attributable.
  const includeClient = opts.includeClient ?? false;
  const clientCol = <T,>(cell: T) => (includeClient ? [cell] : []);

  const headerLabels = includeClient ? ['Client', ...HEADERS] : [...HEADERS];
  const widths = includeClient ? [22, ...COLUMN_WIDTHS] : COLUMN_WIDTHS;
  const header = headerLabels.map((value) => ({ value: value as string, fontWeight: 'bold' as const }));

  const billingActivityDate = (row: BillingInvoiceDetailRow): string => {
    const effective = row.billingEffectiveDate ?? row.shipDate ?? '';
    const actual = row.actualActivityDate ?? row.shipDate ?? '';
    return row.rolledFromWeekend && actual && effective !== actual
      ? `Billed ${effective} | Fulfilled ${actual}`
      : effective;
  };

  const dataRows = rows.map((r) => [
    ...clientCol({ type: String, value: r.clientName ?? '' }),
    { type: String, value: billingActivityDate(r) },
    // Reference/Type/Destination render exactly as the grid and printable invoice do — AC-6
    // is one contract across every serializer, so a value that is blank on screen is blank
    // here too. The reference is never assembled locally.
    { type: String, value: r.displayReference ?? r.orderNumber ?? (r.orderId != null ? `#${r.orderId}` : '') },
    { type: String, value: r.rowType ?? '' },
    { type: String, value: r.destination ?? '' },
    { type: String, value: r.skus ?? r.itemNames ?? '', wrap: true },
    { type: Number, value: num(r.qty) },
    { type: Number, value: num(r.pickpackTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.additionalTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.packageTotal), format: MONEY_FORMAT },
    { type: String, value: r.boxSize ?? '' },
    { type: Number, value: num(r.shippingTotal), format: MONEY_FORMAT },
    { type: Number, value: num(r.storageTotal), format: MONEY_FORMAT },
    moneyCellOrBlank(r.hasReturnProcessingLine, r.returnProcessingTotal),
    moneyCellOrBlank(r.hasReturnPostageLine, r.returnPostageTotal),
    { type: Number, value: num(r.rowTotal), format: MONEY_FORMAT },
  ]);

  const sum = (pick: (r: BillingInvoiceDetailRow) => unknown) =>
    rows.reduce((acc, r) => acc + num(pick(r)), 0);
  const bold = { fontWeight: 'bold' as const };
  const totalsRow = [
    ...clientCol(null),
    { type: String, value: 'Total', ...bold },
    // One null per non-numeric column between the label and Qty: Reference, Type,
    // Destination, SKU(s). Adding a column without adding its null here silently shifts every
    // money total one cell left — the numbers stay correct and land under the wrong headings,
    // which is the worst kind of spreadsheet bug because it still adds up.
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
    { type: Number, value: sum((r) => r.returnProcessingTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.returnPostageTotal), format: MONEY_FORMAT, ...bold },
    { type: Number, value: sum((r) => r.rowTotal), format: MONEY_FORMAT, ...bold },
  ];

  return { sheet: [header, ...dataRows, totalsRow] as InvoiceExcelCell[][], widths };
}

/** Writes the sheet the builder above produced. No cell decisions live here. */
export async function exportInvoiceExcel(
  rows: BillingInvoiceDetailRow[],
  opts: { clientName: string; from: string; to: string; includeClient?: boolean },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const { sheet, widths } = buildInvoiceExcelSheet(rows, { includeClient: opts.includeClient });
  await writeXlsxFile(sheet, {
    columns: widths.map((width) => ({ width })),
    sheet: 'Invoice',
    fileName: `invoice-${slugify(opts.clientName)}-${opts.from}-${opts.to}.xlsx`,
  });
}

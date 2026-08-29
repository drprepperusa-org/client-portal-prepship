/**
 * CP-031 / CP-059 — client-portal Billing "returns are a visible category" guard.
 *
 * CP-031 established that return charges must be broken out as explicit categories instead of
 * disappearing into a generic grand total. CP-059 added the harder half: an absent return line
 * and a real $0.00 return line are different commercial facts, and every serializer must keep
 * them apart.
 *
 * This guard used to be entirely regex over source text. That is how the counterexample got
 * through: it asserted that `moneyCellOrBlank(...)` APPEARED in invoiceExcel.ts, which stayed
 * true while a null presence flag still rendered a fabricated $0.00 — `present === false` was
 * the only blanking branch, and null is not false. Matching the source of a function tells you
 * nothing about what the function returns.
 *
 * So the presentation half now RUNS. It renders the real printable-invoice HTML and builds the
 * real spreadsheet cells, then reads the output cell by cell. Cells are addressed by INDEX, not
 * by searching the row text: a row legitimately contains $0.00 in other columns, so a substring
 * search would pass on an unrelated zero and prove nothing about the return columns.
 *
 * The source-shape checks that remain cover the summary/period read-model aggregates, which
 * have no cheap executable seam and are unchanged by CP-059 — those paths still aggregate in SQL.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
import { renderPortalInvoiceHtml } from '../src/lib/client-portal/invoice-html';
import { buildInvoiceExcelSheet } from '../portal-client/src/lib/invoiceExcel';
import type { BillingInvoiceDetailRow } from '../portal-client/src/lib/api';

const root = process.cwd();
const read = (rel: string) =>
  fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks += 1;
  if (cond) console.log(`PASS ${msg}`);
  else { console.error(`FAIL ${msg}`); failed = true; }
}
const count = (src: string, re: RegExp) => (src.match(re) || []).length;

const readModel = read('src/lib/client-portal/read-models/invoice-details.ts');
const route = read('src/routes/client-portal/invoices.ts');
const api = readActiveClientPortalApiSource();
const page = readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/invoices',
]);
const pkg = JSON.parse(read('package.json'));

// -- 1. Read-model: backend-owned return aggregates in the summary/period queries -------------
// CP-059 moved the DETAIL grain to canonical events, but summary and period totals still
// aggregate here, so these SQL sums must stay.
check(readModel.length > 0, 'the invoice-details read-model exists');
check(
  count(readModel, /lower\(b\.line_type\) in \(\$\{returnPostageLineTypes\}\) then b\.total_cost/g) >= 3,
  'summary + period + detail each SUM return_postage from billing_line_items (backend-owned)',
);
check(
  count(readModel, /lower\(b\.line_type\) in \(\$\{returnProcessingLineTypes\}\) then b\.total_cost/g) >= 3,
  'summary + period + detail each SUM return_processing_fee from billing_line_items (backend-owned)',
);
check(
  /coalesce\(sum\(b\.total_cost\), 0\)::text as row_total/.test(readModel),
  'row_total remains the canonical sum(total_cost) over all line types (returns already included)',
);

// -- 2. /invoice-summary route exposes the return totals in its grand totals -------------------
check(
  /returnPostageTotal: acc\.returnPostageTotal \+ Number\(r\.returnPostageTotal/.test(route) &&
    /returnProcessingTotal: acc\.returnProcessingTotal \+ Number\(r\.returnProcessingTotal/.test(route),
  'the /invoice-summary route folds the return totals into its backend-owned totals',
);

// -- 3. Frontend API types carry the fields ---------------------------------------------------
for (const iface of ['BillingInvoiceSummaryRow', 'BillingInvoiceTotals', 'BillingInvoiceDetailRow']) {
  const m = api.match(new RegExp(`export interface ${iface}\\s*\\{[\\s\\S]*?\\n\\}`));
  const block = m ? m[0] : '';
  check(
    /returnPostageTotal/.test(block) && /returnProcessingTotal/.test(block),
    `${iface} exposes returnPostageTotal + returnProcessingTotal`,
  );
}

// -- 4. The grid renders return columns from backend DTO fields, never React arithmetic -------
check(
  count(page, /'Return Postage'/g) >= 2 && count(page, /'Return Processing'/g) >= 2,
  'the return columns appear in BOTH the period-summary table and the line-item detail table',
);
check(
  /fee: numberValue\(row\.rowTotal\)/.test(page) && /fee: numberValue\(value\.rowTotal\)/.test(page),
  'the Fulfillment Fee (grand total) is still the backend rowTotal (no React re-sum of categories)',
);

// -- 5. EXECUTABLE: what the serializers actually produce --------------------------------------
// Four rows differing ONLY in return-line presence. Every non-return money column is deliberately
// NON-ZERO so a $0.00 anywhere in a row can only have come from a return column.
const baseRow = {
  clientId: 7, clientName: 'Acme', orderId: 4242, orderNumber: '4242',
  qty: '1', rowTotal: '8.60', pickpackTotal: '2.50', additionalTotal: '1.10',
  packageTotal: '0.75', shippingTotal: '6.10', storageTotal: '0.40',
  shipDate: '2026-08-01', billingEffectiveDate: '2026-08-01', actualActivityDate: '2026-08-01',
  boxSize: 'Small', skus: 'SKU-A',
} as unknown as BillingInvoiceDetailRow;

const rows = [
  // (a) an outbound with no return activity — THE PRODUCER'S REAL ABSENT SHAPE, `false + 0`.
  //     This fixture said `false + null` until review found that PrepShip never emits null
  //     (billing-detail-row-sot.ts:281). A serializer that blanks on null but prints on 0 would
  //     have passed the old fixture and fabricated $0.00 on every outbound row in production.
  { ...baseRow, displayReference: 'REF-A', rowType: 'Outbound', destination: 'Domestic',
    returnId: null, hasReturnPostageLine: false, hasReturnProcessingLine: false,
    returnPostageTotal: 0, returnProcessingTotal: 0 },
  // (b) a return whose postage line EXISTS and is genuinely 0.00
  { ...baseRow, displayReference: 'REF-B', rowType: 'Return', destination: 'Domestic',
    returnId: 501, hasReturnPostageLine: true, hasReturnProcessingLine: false,
    returnPostageTotal: '0', returnProcessingTotal: 0 },
  // (c) a return with real amounts on both lines
  { ...baseRow, displayReference: 'REF-C', rowType: 'Return', destination: 'International',
    returnId: 502, hasReturnPostageLine: true, hasReturnProcessingLine: true,
    returnPostageTotal: '7.73', returnProcessingTotal: '3.00' },
  // (d) THE COUNTEREXAMPLE. Presence is null/undefined, not false. The boundary rejects such a
  //     row now, but the serializers are reachable from other callers and must not be the last
  //     thing standing between a contract slip and a charge that was never billed.
  { ...baseRow, displayReference: 'REF-D', rowType: 'Return', destination: 'Domestic',
    returnId: 503, hasReturnPostageLine: null, hasReturnProcessingLine: undefined,
    returnPostageTotal: 4.5, returnProcessingTotal: 4.5 },
] as unknown as BillingInvoiceDetailRow[];

// -- 5a. Printable invoice HTML ---------------------------------------------------------------
const html = renderPortalInvoiceHtml({
  clientName: 'Acme', dateFrom: '2026-08-01', dateTo: '2026-08-31',
  details: rows as never, truncated: false,
  invoiceTotals: {
    orderCount: 1, qty: 4, pickPackTotal: 10, additionalTotal: 4.4, packageTotal: 3,
    shippingTotal: 24.4, storageTotal: 1.6, grandTotal: 43.4,
  },
});

// Column order in the printable row, taken from the template in invoice-html.ts.
const HTML_CELLS = 19;
const HTML_PROCESSING = 13;
const HTML_POSTAGE = 14;
const HTML_RETURN_TOTAL = 15;
const HTML_REPLACE_POSTAGE = 16;
const HTML_REPLACE_PICKPACK = 17;
const HTML_ROW_TOTAL = 18;

const htmlRows = new Map<string, string[]>();
for (const chunk of (html.match(/<tbody>[\s\S]*?<\/tbody>/) ?? [''])[0].split('</tr>')) {
  if (!chunk.includes('<td')) continue;
  const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
  assert.equal(cells.length, HTML_CELLS, `expected ${HTML_CELLS} cells per row, got ${cells.length}`);
  htmlRows.set(cells[1], cells);
}
// A needle that is not found is a SETUP failure, not a pass.
assert.equal(htmlRows.size, rows.length, `expected ${rows.length} itemized rows, got ${htmlRows.size}`);
const htmlCells = (reference: string): string[] => {
  const cells = htmlRows.get(reference);
  assert.ok(cells, `the ${reference} row did not render — the fixture never reached the serializer`);
  return cells;
};
const DASH = '&mdash;';

check(
  htmlCells('REF-A')[HTML_POSTAGE] === DASH && htmlCells('REF-A')[HTML_PROCESSING] === DASH,
  'HTML: the producer absent shape (false + 0) prints BLANK, never the 0 it carries',
);
check(
  htmlCells('REF-B')[HTML_POSTAGE] === '$0.00',
  'HTML: a return line that genuinely IS $0.00 prints $0.00 — absent is blanked, a real zero is not',
);
check(
  htmlCells('REF-B')[HTML_PROCESSING] === DASH,
  'HTML: the same row blanks the processing line it does not have, beside its real $0.00 postage',
);
check(
  htmlCells('REF-C')[HTML_POSTAGE] === '$7.73' && htmlCells('REF-C')[HTML_PROCESSING] === '$3.00',
  'HTML: real return amounts print verbatim',
);
check(
  htmlCells('REF-D')[HTML_POSTAGE] === DASH && htmlCells('REF-D')[HTML_PROCESSING] === DASH,
  'HTML: NULL/undefined presence prints blank even with money attached — only true renders',
);

// -- 5b. Spreadsheet cells --------------------------------------------------------------------
const { sheet } = buildInvoiceExcelSheet(rows);
const header = sheet[0] as Array<{ value: string }>;
const processingCol = header.findIndex((cell) => cell?.value === 'Return Processing');
const postageCol = header.findIndex((cell) => cell?.value === 'Return Postage');
assert.ok(processingCol > 0 && postageCol > 0, 'the export must have Return Processing + Return Postage columns');

const dataRows = sheet.slice(1, -1);
assert.equal(dataRows.length, rows.length, `expected ${rows.length} data rows, got ${dataRows.length}`);
const cell = (rowIndex: number, col: number) => dataRows[rowIndex]?.[col] as { type?: unknown; value?: unknown };

check(
  cell(0, postageCol)?.type === String && cell(0, postageCol)?.value === '',
  'XLSX: the producer absent shape (false + 0) is a BLANK cell, never the 0 it carries',
);
check(
  cell(1, postageCol)?.type === Number && cell(1, postageCol)?.value === 0,
  'XLSX: a real $0.00 return-postage line is a NUMERIC 0 — the two stay distinguishable in a filter',
);
check(
  cell(2, postageCol)?.value === 7.73 && cell(2, processingCol)?.value === 3,
  'XLSX: real return amounts are written as numbers, verbatim',
);
check(
  cell(3, postageCol)?.type === String && cell(3, processingCol)?.type === String,
  'XLSX: NULL/undefined presence is blank even carrying 4.50 — presence decides, not the amount',
);

// The totals row must line up under its headings. A shifted totals row still adds up, which is
// what makes it the worst kind of spreadsheet bug.
const totals = sheet[sheet.length - 1] as Array<{ value?: unknown } | null>;
check(
  totals.length === header.length,
  `XLSX: the totals row has one cell per column (${totals.length} vs ${header.length})`,
);
// 0 + 0 + 7.73 + 4.50. The totals row sums AMOUNTS, ignoring presence — which is correct
// precisely because the producer emits 0 for an absent fee rather than null: an absent line
// contributes nothing to the total while still being blanked in its own cell. Had the producer
// emitted null, num() would coerce it to 0 anyway; the distinction lives in presence, not here.
check(
  (totals[postageCol] as { value?: unknown })?.value === 12.23,
  'XLSX: the return-postage total sums amounts under its own heading; absent rows add their 0',
);

// -- 6. package.json wiring -------------------------------------------------------------------
check(
  pkg.scripts?.['test:client-portal-billing-returns-display'] ===
    'tsx scripts/client-portal-billing-returns-display-guard.ts',
  'package.json exposes test:client-portal-billing-returns-display',
);

// A checks/checks report is a tautology. Pinning the count means deleting a block fails the
// guard instead of quietly shrinking it.
const EXPECTED_CHECKS = 22;
if (checks !== EXPECTED_CHECKS) {
  console.error(`FAIL expected ${EXPECTED_CHECKS} checks to run; ${checks} did`);
  failed = true;
}

if (failed) process.exit(1);
console.log(`\nCP-031/CP-059 client-portal Billing returns-display guard passed — ${checks} checks.`);

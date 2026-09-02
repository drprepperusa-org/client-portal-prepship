import { readFileSync } from 'node:fs';
import { readSourceTree } from './lib/source-tree.mjs';
import type { BillingInvoiceDetailRow } from '../portal-client/src/lib/api';
import { renderPortalInvoiceHtml } from '../src/lib/client-portal/invoice-html';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
    return;
  }
  console.log(`ok   ${name}`);
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = source.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex);
}

const invoices = readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/invoices',
]);
const routes = read('src/routes/client-portal/invoices.ts');
const readModel = read('src/lib/client-portal/read-models/invoice-details.ts');
const invoiceHtml = read('src/lib/client-portal/invoice-html.ts');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

const summaryBlock = sliceBetween(
  readModel,
  'export async function portalInvoiceSummary',
  'export async function portalInvoiceDetailCount',
);
const periodSummaryBlock = sliceBetween(readModel, 'export async function portalInvoicePeriodSummary', '// CP-016');
const detailBlock = sliceBetween(readModel, 'export async function portalInvoiceDetails', 'const dimsFromRaw');
const totalsBlock = sliceBetween(invoices, 'export function toBillingTotals', 'export function toPeriodSummaries');

check('summary read model is SQL aggregated and uncapped for high-volume clients',
  /count\(distinct b\.order_id\)::text as orders/.test(summaryBlock) &&
    /coalesce\(sum\(b\.total_cost\), 0\)::text as row_total/.test(summaryBlock) &&
    !/\blimit\b/i.test(summaryBlock));

check('period summary read model is SQL aggregated and uncapped for >1000 grouped orders',
  /group by b\.client_id, c\.name, 3, 4/.test(periodSummaryBlock) &&
    /count\(distinct b\.order_id\)::text as orders/.test(periodSummaryBlock) &&
    !/\blimit\b/i.test(periodSummaryBlock));

check('Billing footer consumes backend summary totals instead of reducing visible rows',
  /value\?: BillingInvoiceTotals/.test(totalsBlock) &&
    /return value/.test(totalsBlock) &&
    !/summary\.reduce/.test(totalsBlock));

// CP-059: the slice and its total now come from ONE canonical call rather than a separate
// read + count pair. The property PS-384 protects is unchanged — a page must ship with the
// count of the FULL filtered set, so the footer and pagination cannot disagree with the grid.
// What changed is what is being counted: EVENT rows, not distinct orders. An order with an
// outbound and two returns is 3, and the old grouped count reported 1.
check('detail endpoint returns a paginated slice plus full event-row count',
  /portalCanonicalInvoiceEvents\(scope, authorization, \{[\s\S]{0,240}page, pageSize, sortBy, sortDir,/.test(routes) &&
    /total: result\.total/.test(routes) &&
    /totalPages: Math\.max\(1, Math\.ceil\(result\.total \/ pageSize\)\)/.test(routes));

check('detail read model caps only the visible/unpaginated detail path, not summary truth',
  /limit \$\{input\.pageSize \?\? \(input\.clientId \? 5000 : 1000\)\}/.test(detailBlock));

// CP-068: the export no longer pages rows into the browser at all — it downloads PrepShip's
// workbook, which PrepShip renders over the FULL period from its own uncapped query. The
// truncation risk this guard protected against cannot exist on that path, so the property
// became "the export reads no rows".
check('exports download PrepShip\'s whole-period workbook instead of paging capped detail rows',
  /portalApi\.invoiceWorkbookRange\(/.test(invoices) &&
    !/invoiceDetailsRange|fetchAllInvoiceRows/.test(sliceBetween(invoices, 'async function exportExcel', 'return { opening')) &&
    !/pageSize: 5000/.test(invoices));

check('printable invoice renderer has an explicit partial-itemization note',
  /Amount due above is complete/.test(invoiceHtml) &&
    /itemized list and its quantity/.test(invoiceHtml) &&
    /truncated\?: boolean/.test(invoiceHtml));

const highVolumeRows: BillingInvoiceDetailRow[] = Array.from({ length: 6001 }, (_, index) => ({
  clientId: 44,
  clientName: 'Tran Agency',
  orderId: index + 1,
  orderNumber: `HV-${String(index + 1).padStart(5, '0')}`,
  qty: '1',
  rowTotal: '1.00',
}));
const html = renderPortalInvoiceHtml({
  clientName: 'Tran Agency',
  dateFrom: '2026-04-03',
  dateTo: '2026-07-01',
  details: highVolumeRows.slice(0, 5000) as never,
  truncated: true,
  invoiceTotals: {
    orderCount: 6001,
    qty: 6001,
    pickPackTotal: 6001,
    additionalTotal: 0,
    packageTotal: 0,
    shippingTotal: 0,
    storageTotal: 0,
    grandTotal: 6001,
  },
});

check('printable invoice keeps amount due complete while declaring partial itemization',
  html.includes('Amount due above is complete for the full period (6,001 orders)') &&
    html.includes('itemized list and its quantity subtotal below are partial') &&
    html.includes('Total Amount Due') &&
    html.includes('$6001.00'));

check('package exposes PS-384 high-volume billing parity guard',
  packageJson.scripts?.['test:ps-384-high-volume-billing-parity'] ===
    'tsx scripts/ps-384-high-volume-billing-parity-guard.ts');

if (failures > 0) {
  console.error(`\nFAIL PS-384 high-volume Billing parity guard (${failures} failing)`);
  process.exit(1);
}

console.log('\nPASS PS-384 high-volume Billing parity guard');

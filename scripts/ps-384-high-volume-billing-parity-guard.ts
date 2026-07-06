import { readFileSync } from 'node:fs';
import type { BillingInvoiceDetailRow } from '../portal-client/src/lib/api';
import { fetchAllInvoiceRows, INVOICE_EXPORT_MAX_PAGES, INVOICE_EXPORT_PAGE_SIZE } from '../portal-client/src/lib/invoiceRows';
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

const invoices = read('portal-client/src/pages/Invoices.tsx');
const invoiceRows = read('portal-client/src/lib/invoiceRows.ts');
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
const totalsBlock = sliceBetween(invoices, 'const totals: BillingTotals', '// Line items load');

check('summary read model is SQL aggregated and uncapped for high-volume clients',
  /count\(distinct b\.order_id\)::text as orders/.test(summaryBlock) &&
    /coalesce\(sum\(b\.total_cost\), 0\)::text as row_total/.test(summaryBlock) &&
    !/\blimit\b/i.test(summaryBlock));

check('period summary read model is SQL aggregated and uncapped for >1000 grouped orders',
  /group by b\.client_id, c\.name, 3, 4/.test(periodSummaryBlock) &&
    /count\(distinct b\.order_id\)::text as orders/.test(periodSummaryBlock) &&
    !/\blimit\b/i.test(periodSummaryBlock));

check('Billing footer consumes backend summary totals instead of reducing visible rows',
  /const t = summaryQuery\.data\?\.totals/.test(totalsBlock) &&
    !/summary\.reduce/.test(totalsBlock));

check('detail endpoint returns a paginated slice plus full grouped-row count',
  /portalInvoiceDetails\(scope, \{ clientId, dateFrom, dateTo, page, pageSize, sortBy, sortDir \}\)/.test(routes) &&
    /portalInvoiceDetailCount\(scope, \{ clientId, dateFrom, dateTo \}\)/.test(routes) &&
    /pagination: \{ page, pageSize, total, totalPages/.test(routes));

check('detail read model caps only the visible/unpaginated detail path, not summary truth',
  /limit \$\{input\.pageSize \?\? \(input\.clientId \? 5000 : 1000\)\}/.test(detailBlock));

check('exports use the shared paginated fetch-all helper, not the capped unpaginated path',
  /import \{ fetchAllInvoiceRows as fetchAllInvoiceRowsPaged \} from '@\/lib\/invoiceRows'/.test(invoices) &&
    /fetcher: portalApi\.invoiceDetailsRange/.test(invoices) &&
    !/pageSize: 5000/.test(invoices));

check('fetch-all helper walks backend pagination with an explicit row ceiling',
  /INVOICE_EXPORT_PAGE_SIZE = 200/.test(invoiceRows) &&
    /INVOICE_EXPORT_MAX_PAGES = 250/.test(invoiceRows) &&
    /res\.pagination\?\.totalPages/.test(invoiceRows));

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
const calls: Array<{ page?: number; pageSize?: number; clientId?: number }> = [];
const completeExport = await fetchAllInvoiceRows({
  token: 'token',
  clientId: 44,
  rangeFrom: '2026-04-03',
  rangeTo: '2026-07-01',
  fetcher: async (_token, _from, _to, clientId, opts = {}) => {
    calls.push({ page: opts.page, pageSize: opts.pageSize, clientId });
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? INVOICE_EXPORT_PAGE_SIZE;
    return {
      data: highVolumeRows.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        pageSize,
        total: highVolumeRows.length,
        totalPages: Math.ceil(highVolumeRows.length / pageSize),
      },
    };
  },
});

check('export helper includes every row for a >5000-detail high-volume fixture',
  completeExport.rows.length === 6001 &&
    completeExport.truncated === false &&
    calls.length === Math.ceil(6001 / INVOICE_EXPORT_PAGE_SIZE) &&
    calls.every((call) => call.pageSize === INVOICE_EXPORT_PAGE_SIZE && call.clientId === 44),
  { rows: completeExport.rows.length, calls: calls.length, truncated: completeExport.truncated });

const ceilingExport = await fetchAllInvoiceRows({
  token: 'token',
  clientId: undefined,
  rangeFrom: '2026-04-03',
  rangeTo: '2026-07-01',
  fetcher: async (_token, _from, _to, _clientId, opts = {}) => {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? INVOICE_EXPORT_PAGE_SIZE;
    return {
      data: Array.from({ length: pageSize }, (_, index) => ({
        clientId: index % 2 === 0 ? 44 : 45,
        orderId: (page - 1) * pageSize + index + 1,
        rowTotal: '1.00',
      })),
      pagination: {
        page,
        pageSize,
        total: (INVOICE_EXPORT_MAX_PAGES + 1) * pageSize,
        totalPages: INVOICE_EXPORT_MAX_PAGES + 1,
      },
    };
  },
});

check('export helper flags a partial export instead of silently hiding the hard page ceiling',
  ceilingExport.truncated === true &&
    ceilingExport.rows.length === INVOICE_EXPORT_MAX_PAGES * INVOICE_EXPORT_PAGE_SIZE);

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

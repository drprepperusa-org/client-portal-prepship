import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-016 — Billing line-item header sorting must apply across ALL filtered pages,
// not just the loaded page. The backend read-model owns a whitelisted sort that
// runs on the full filtered set BEFORE limit/offset; the frontend owns sort
// intent (controlled DataTable) and resets to page 1 on change. This guard pins
// that architecture so page-local sorting can't creep back.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const readModelRaw = read('src/lib/client-portal/read-models/invoice-details.ts');
const readModel = flat(readModelRaw);
const route = flat(read('src/routes/client-portal/invoices.ts'));
const api = flat(readActiveClientPortalApiSource());
const hooks = flat(read('portal-client/src/lib/hooks.ts'));
const invoices = flat(readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/invoices',
]));
const dataTable = flat(readSourceTree([
  'portal-client/src/components/ui/DataTable.tsx',
  'portal-client/src/components/ui/data-table',
]));
const pkg = JSON.parse(read('package.json'));

// ── Read-model owns a whitelisted sort applied BEFORE pagination ──
assert(
  readModel.includes('const INVOICE_DETAIL_SORT_EXPR') &&
    ['order:', 'date:', 'fee:', 'shipping:', 'qty:', 'pickpack:'].every((k) => readModel.includes(k)),
  'read-model defines the whitelisted INVOICE_DETAIL_SORT_EXPR (order/date/fee/shipping/qty/pickpack)',
);
assert(
  readModel.includes('function invoiceDetailOrderBy(') &&
    readModel.includes('order by min(b.ship_date) desc, b.order_id desc'),
  'invoiceDetailOrderBy falls back to the default ship-date order for unknown/absent keys',
);
assert(
  /order by \$\{expr\} \$\{dir\} nulls last, b\.order_id desc/.test(readModelRaw),
  'the selected sort uses a unique per-group tie-breaker (b.order_id) for deterministic paging',
);
// Sort is applied to the query BEFORE limit/offset (whole-set sort, then page).
const orderByIdx = readModel.indexOf('${invoiceDetailOrderBy(input.sortBy, input.sortDir)}');
const limitIdx = readModel.indexOf('limit ${input.pageSize');
assert(orderByIdx > 0 && limitIdx > orderByIdx, 'the main query applies the sort BEFORE limit/offset (sorts the full set, then paginates)');
assert(
  readModel.includes('sortHeritageOverrideRows(') && readModel.includes('sort the FULL override set before slicing'),
  'the Heritage Prep Fee override path sorts the full set before it slices a page',
);
assert(
  readModel.includes('sortBy?: string | null') && readModel.includes('sortDir?: string | null'),
  'portalInvoiceDetails accepts sortBy/sortDir',
);

// ── Route passes the sort params through ──
assert(
  route.includes("const sortBy = c.req.query('sortBy')") &&
    route.includes("const sortDir = c.req.query('sortDir')") &&
    route.includes('portalInvoiceDetails(scope, { clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive, page, pageSize, sortBy, sortDir })'),
  '/invoice-details paged mode reads sortBy/sortDir and passes them to the read-model',
);

// ── Frontend threads the sort through the API + hook ──
assert(
  api.includes('sortBy?: string; sortDir?:') && api.includes('sortBy: opts.sortBy') && api.includes('sortDir: opts.sortDir'),
  'api.invoiceDetailsRange forwards sortBy/sortDir',
);
assert(
  hooks.includes("'invoice-details-range', dateFrom, dateTo, clientId ?? 'scope', page, pageSize, sortBy ?? '', sortDir ?? ''") &&
    hooks.includes('{ page, pageSize, sortBy, sortDir }'),
  'useInvoiceDetailsRange keys on + forwards sortBy/sortDir',
);

// ── Invoices owns sort state, drives the query, resets page on change ──
assert(invoices.includes('const [detailSort, setDetailSort]'), 'Invoices owns the Billing detail sort state');
assert(
  invoices.includes('detailPage, detailPageSize, detailSort?.key, detailSort?.dir'),
  'Invoices passes the active sort into the paginated query',
);
assert(
  invoices.includes('onSortChange={(sort) => {') &&
    invoices.includes('setDetailSort(sort)') &&
    invoices.includes('setDetailPage(1)') &&
    invoices.includes('sort={detailSort}'),
  'Invoices puts the line-item table in controlled sort mode and resets to page 1 on sort change',
);

// ── DataTable controlled (server-sort) mode: never re-sorts just the page ──
assert(
  dataTable.includes('onSortChange') && dataTable.includes('const controlled = onSortChange != null'),
  'DataTable supports a controlled server-sort mode',
);
assert(
  dataTable.includes('if (controlled || !sort) return rows'),
  'DataTable in server-sort mode renders rows as-is (no page-local re-sort)',
);

assert(
  pkg.scripts?.['test:billing-line-item-sort-pagination'] ===
    'node scripts/client-portal-billing-line-item-sort-guard.mjs',
  'package exposes test:billing-line-item-sort-pagination',
);

if (failed) process.exit(1);
console.log('\nclient portal billing line-item sort guard passed.');

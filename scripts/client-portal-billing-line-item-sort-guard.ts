/**
 * CP-016 / CP-059 — Billing line-item header sorting must apply across ALL filtered pages,
 * not just the loaded page.
 *
 * CP-016 put a whitelisted sort in the backend, applied to the full filtered set before
 * limit/offset, with the frontend owning only sort intent. CP-059 moved the detail grain from
 * the order-grain SQL read model to canonical billing events — so the ordering that actually
 * runs now lives in canonical-invoice-events.ts.
 *
 * This guard used to assert the SQL text in invoice-details.ts: `INVOICE_DETAIL_SORT_EXPR`,
 * `invoiceDetailOrderBy`, `order by ... before limit`. Every one of those strings is still in
 * the file and still matched, but the detail route no longer calls that code. The guard was
 * green against an unreached implementation, which is indistinguishable from no guard at all.
 *
 * The ordering half now EXECUTES the function the route reaches. The frontend half stays as
 * source assertions: sort INTENT is a wiring fact (controlled table, page reset, query key),
 * and wiring is what source shape can legitimately prove.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
import {
  orderCanonicalEvents,
  CANONICAL_SORTABLE_KEYS,
} from '../src/lib/client-portal/read-models/canonical-invoice-events';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

let failed = false;
let checks = 0;
function check(condition: boolean, message: string): void {
  checks += 1;
  if (condition) console.log(`PASS ${message}`);
  else { console.error(`FAIL ${message}`); failed = true; }
}

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

// -- 1. EXECUTABLE: the ordering the detail route actually reaches -----------------------------
type Row = Parameters<typeof orderCanonicalEvents>[0][number];
const row = (over: Record<string, unknown>) => ({
  clientId: 7, clientName: 'Acme', orderId: 1, orderNumber: '1', returnId: null,
  rowType: 'Outbound', displayReference: '1', destination: 'Domestic',
  hasReturnPostageLine: false, hasReturnProcessingLine: false,
  pickpackTotal: 0, additionalTotal: 0, packageTotal: 0, shippingTotal: 0,
  storageTotal: 0, adjustmentTotal: 0, returnPostageTotal: null,
  returnProcessingTotal: null, returnTotal: null, grandTotal: 0,
  shipDate: '2026-08-01', actualActivityDate: '2026-08-01',
  billingEffectiveDate: '2026-08-01', billingPolicyVersion: 'ps-437-v1',
  rolledFromWeekend: false, recipientName: null, boxSize: null, displayQty: '1', qty: 1,
  ...over,
}) as unknown as Row;

const refs = (rows: readonly Row[]) => rows.map((r) => (r as { displayReference: string }).displayReference);

check(
  ['orderNumber', 'displayReference', 'rowType', 'destination', 'grandTotal',
    'returnPostageTotal', 'returnProcessingTotal', 'shipDate', 'billingEffectiveDate']
    .every((key) => CANONICAL_SORTABLE_KEYS.includes(key)),
  'the canonical ordering whitelists the columns the grid offers as sortable',
);

// Ascending and descending both order by the requested key.
const moneyRows = [
  row({ orderId: 3, displayReference: 'C', grandTotal: 30 }),
  row({ orderId: 1, displayReference: 'A', grandTotal: 10 }),
  row({ orderId: 2, displayReference: 'B', grandTotal: 20 }),
];
check(
  refs(orderCanonicalEvents(moneyRows, 'grandTotal', 'asc')).join('') === 'ABC' &&
    refs(orderCanonicalEvents(moneyRows, 'grandTotal', 'desc')).join('') === 'CBA',
  'a whitelisted key sorts ascending and descending',
);

// An unknown key must not randomise the grid; it falls through to the stable relational order.
const unknownOnce = refs(orderCanonicalEvents(moneyRows, 'labelCost', 'desc'));
const unknownTwice = refs(orderCanonicalEvents([...moneyRows].reverse(), 'labelCost', 'desc'));
check(
  unknownOnce.join('') === unknownTwice.join('') && unknownOnce.join('') === 'ABC',
  'an unknown sort key falls back to a total, input-order-independent order (never a random one)',
);

// A field that EXISTS on the row but is NOT whitelisted must not sort either. The check above
// cannot prove this on its own: 'labelCost' is undefined on every row, so dropping the whitelist
// entirely still ties and still returns the stable order. `orderId` is real, is deliberately
// absent from the whitelist, and disagrees with the stable order under descending.
const byOrderIdDesc = refs(orderCanonicalEvents(moneyRows, 'orderId', 'desc'));
check(
  byOrderIdDesc.join('') === 'ABC',
  'a REAL but non-whitelisted field (orderId) does not sort — the whitelist is enforced, not decorative',
);

// Nulls last in BOTH directions: a missing amount is not a small one, and floating it to the
// top of a money column reads as a zero.
const withNulls = [
  row({ orderId: 1, displayReference: 'HAS', returnPostageTotal: 5 }),
  row({ orderId: 2, displayReference: 'NONE', returnPostageTotal: null }),
  row({ orderId: 3, displayReference: 'ALSO', returnPostageTotal: 9 }),
];
check(
  refs(orderCanonicalEvents(withNulls, 'returnPostageTotal', 'asc')).at(-1) === 'NONE' &&
    refs(orderCanonicalEvents(withNulls, 'returnPostageTotal', 'desc')).at(-1) === 'NONE',
  'nulls sort last in both directions — an absent amount never leads a money column',
);

// THE PROPERTY CP-016 EXISTS FOR: the sort covers the FULL filtered set, so page 2 holds the
// globally 3rd and 4th rows. A page-local sort would return the input order on every page.
const wholeSet = [
  row({ orderId: 5, displayReference: 'e', grandTotal: 50 }),
  row({ orderId: 1, displayReference: 'a', grandTotal: 10 }),
  row({ orderId: 4, displayReference: 'd', grandTotal: 40 }),
  row({ orderId: 2, displayReference: 'b', grandTotal: 20 }),
  row({ orderId: 3, displayReference: 'c', grandTotal: 30 }),
];
const ordered = orderCanonicalEvents(wholeSet, 'grandTotal', 'asc');
check(
  refs(ordered.slice(2, 4)).join('') === 'cd',
  'the sort covers the whole filtered set before slicing — page 2 holds the globally 3rd/4th rows',
);
// Same set, page-local ordering, for contrast: if the sort ran per page, page 2 of the RAW
// input would be 'db', not 'cd'. Asserting the difference keeps the check from passing for a
// trivial reason on an already-sorted fixture.
check(
  refs(wholeSet.slice(2, 4)).join('') === 'db',
  'the fixture is genuinely unsorted, so the previous check could not have passed by accident',
);

// Stable tiebreak: rows sharing a sort value keep a deterministic relational order, so paging
// cannot drop or duplicate one. Feed the tie in both input orders.
// Both returns deliberately carry the SAME displayReference. A label can repeat; only
// (orderId, returnId) is unique. A tiebreak keyed on the label would tie these two completely
// and let input order decide, which is how a row moves between pages and is dropped.
const tied = [
  row({ orderId: 9, returnId: 2, rowType: 'Return', displayReference: '9-RETURN', grandTotal: 5 }),
  row({ orderId: 9, returnId: null, rowType: 'Outbound', displayReference: '9', grandTotal: 5 }),
  row({ orderId: 9, returnId: 1, rowType: 'Return', displayReference: '9-RETURN', grandTotal: 5 }),
];
const identity = (rows: readonly Row[]) =>
  rows.map((r) => {
    const x = r as { orderId: number | null; returnId: number | null };
    return `${x.orderId}:${x.returnId}`;
  });
const tiedOnce = identity(orderCanonicalEvents(tied, 'grandTotal', 'asc'));
const tiedReversed = identity(orderCanonicalEvents([...tied].reverse(), 'grandTotal', 'asc'));
check(
  tiedOnce.join('|') === tiedReversed.join('|'),
  'rows tied on the sort value keep a deterministic RELATIONAL order regardless of input order',
);
check(
  new Set(tiedOnce).size === tied.length,
  'two returns sharing one label stay separable — the tiebreak uses (orderId, returnId), not the label',
);

// -- 2. Route threads sort intent into the canonical read model --------------------------------
check(
  route.includes("const sortBy = c.req.query('sortBy')") &&
    route.includes("const sortDir = c.req.query('sortDir')") &&
    /portalCanonicalInvoiceEvents\(scope, authorization, \{[\s\S]{0,240}sortBy, sortDir,/.test(route),
  '/invoice-details paged mode reads sortBy/sortDir and passes them to the canonical read model',
);

// -- 3. Frontend threads the sort through the API + hook ---------------------------------------
check(
  api.includes('sortBy?: string; sortDir?:') && api.includes('sortBy: opts.sortBy') && api.includes('sortDir: opts.sortDir'),
  'api.invoiceDetailsRange forwards sortBy/sortDir',
);
check(
  hooks.includes("'invoice-details-range', dateFrom, dateTo, clientId ?? 'scope', page, pageSize, sortBy ?? '', sortDir ?? ''") &&
    hooks.includes('{ page, pageSize, sortBy, sortDir }'),
  'useInvoiceDetailsRange keys on + forwards sortBy/sortDir',
);

// -- 4. Invoices owns sort state, drives the query, resets page on change ----------------------
check(invoices.includes('const [detailSort, setDetailSort]'), 'Invoices owns the Billing detail sort state');
check(
  invoices.includes('detailPage, detailPageSize, detailSort?.key, detailSort?.dir'),
  'Invoices passes the active sort into the paginated query',
);
check(
  invoices.includes('onSortChange={(sort) => {') &&
    invoices.includes('setDetailSort(sort)') &&
    invoices.includes('setDetailPage(1)') &&
    invoices.includes('sort={detailSort}'),
  'Invoices puts the line-item table in controlled sort mode and resets to page 1 on sort change',
);

// -- 5. DataTable controlled (server-sort) mode: never re-sorts just the page -------------------
check(
  dataTable.includes('onSortChange') && dataTable.includes('const controlled = onSortChange != null'),
  'DataTable supports a controlled server-sort mode',
);
check(
  dataTable.includes('if (controlled || !sort) return rows'),
  'DataTable in server-sort mode renders rows as-is (no page-local re-sort)',
);

check(
  pkg.scripts?.['test:billing-line-item-sort-pagination'] ===
    'tsx scripts/client-portal-billing-line-item-sort-guard.ts',
  'package exposes test:billing-line-item-sort-pagination',
);

const EXPECTED_CHECKS = 18;
if (checks !== EXPECTED_CHECKS) {
  console.error(`FAIL expected ${EXPECTED_CHECKS} checks to run; ${checks} did`);
  failed = true;
}

assert.ok(true);
if (failed) process.exit(1);
console.log(`\nclient portal billing line-item sort guard passed — ${checks} checks.`);

import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-011 — Billing summary grand totals must be backend-owned. The Billing
// footer (Total row) previously reduced the per-period rows in React, which
// could drift from the printable invoice HTML, the Excel export, Billing, and
// the canonical billing ledger. The /invoice-summary route now returns the
// grand totals; the frontend renders them (no row reduction for money).
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

const route = flat(read('src/routes/client-portal/invoices.ts'));
const invoices = readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/invoices',
]);
const invoicesFlat = flat(invoices);
const api = flat(readActiveClientPortalApiSource());
const invoiceHtml = read('src/lib/client-portal/invoice-html.ts');
const pkg = JSON.parse(read('package.json'));

// ── Backend /invoice-summary owns the grand totals ──
//
// CP-011's REQUIREMENT stands: the footer is reduced backend-side over the full aggregated set,
// never by the frontend over a page of rows. What changed in CP-067 is WHICH rows it reduces.
// The list's money now comes from PrepShip's canonical owner — the same totals the invoice
// reads — so the reduction runs over `canonicalRows`, not over this repo's own aggregation.
// Pinning `rows.reduce(` would have demanded the divergent aggregation back.
assert(
  route.includes('const totals = canonicalRows.reduce('),
  'invoice-summary route reduces the footer over the CANONICAL rows, backend-side',
);
assert(
  route.includes('return c.json({ data: canonicalRows, totals, billingVisible: true });'),
  'invoice-summary route returns the canonical rows and their backend-owned totals',
);
// The list must take its money from PrepShip, not compute it here — the whole point of CP-067.
assert(
  route.includes('fetchCanonicalInvoiceTotals('),
  'invoice-summary must read canonical totals from PrepShip, not aggregate money locally',
);
// Fail closed: a list that silently renders this repo's aggregation when upstream is down
// restores the exact divergence CP-067 removed, and it would be invisible.
assert(
  /if\s*\(\s*!result\.ok\s*\)[\s\S]{0,400}?result\.status as 401 \| 403 \| 502 \| 503/.test(route),
  'invoice-summary must fail closed when canonical totals are unavailable',
);
assert(
  route.includes('portal.invoice_summary.denied') && route.includes('billingVisible: false'),
  'invoice-summary still redacts (billingVisible:false) without financial access',
);
assert(
  route.includes('return c.json({ data: [], totals: null, billingVisible: false });') &&
    !route.includes('billingVisible: false }, 403'),
  'billing redaction returns an empty read-model payload instead of a load-error status',
);

// ── Frontend Billing renders backend totals — no row reduction for money ──
assert(
  invoicesFlat.includes('summaryQuery.data?.totals'),
  'Billing footer reads the backend-owned totals',
);
assert(
  !invoicesFlat.includes('summary.reduce(addBillingTotals') && !invoices.includes('function addBillingTotals'),
  'Billing no longer reduces the per-period rows into a grand total (addBillingTotals removed)',
);
assert(
  invoices.includes('title="No billing available"') &&
    invoices.includes('Billing is not available for this account yet.') &&
    !invoices.includes('Financials restricted'),
  'Billing renders redacted/empty access as "No billing available" instead of a permission error',
);

// ── API type carries the backend totals ──
assert(
  api.includes('totals?: BillingInvoiceTotals') && api.includes('export interface BillingInvoiceTotals'),
  'the period-summary API response type exposes backend totals',
);

// ── CP-024, as amended by CP-066: the printable /invoice HTML's money is backend-owned ──
//
// CP-024's REQUIREMENT stands: amount-due and every section total must come from an uncapped
// canonical aggregate, NEVER a reduction over the row-capped detail rows.
//
// What changed is WHICH aggregate is canonical. These two assertions used to pin the literal
// call `billingSummary(...)` + `summary.clients[0]` — this repo's OWN aggregation. That made the
// portal a second source of truth for invoice money, and it implements neither of PrepShip's
// suppression rules (PS-491 duplicate copies, cancelled-no-charge). Measured on HUGRAB's Aug 2026
// invoice, it billed the customer for 8 cancelled orders and a duplicate copy of order 3629 —
// $30.50 over, and one order too many. The guard was pinning the defect in place.
//
// So it now asserts the OUTCOME (money comes from the canonical owner, and is not re-derived
// here) rather than a call-site spelling. The owner is PrepShip's billingInvoiceHeaderTotals,
// delivered in the same response as the rows.
assert(
  route.includes('detailResult.totals') && !/\bbillingSummary\s*\(/.test(route),
  'the /invoice handler takes its money from PrepShip\'s canonical totals and does not re-derive it',
);
assert(
  route.includes('grandTotal: canonicalTotals.grandTotal') &&
    route.includes('pickPackTotal: canonicalTotals.pickPackTotal') &&
    route.includes('shippingTotal: canonicalTotals.shippingTotal') &&
    route.includes('storageTotal: canonicalTotals.storageTotal'),
  'the printable invoiceTotals source amount-due and every section total from the canonical owner',
);
// Fail closed: absent canonical totals must not render $0.00 or silently fall back to a local
// aggregation, because either would reintroduce the divergence this replaced.
assert(
  /if\s*\(\s*!canonicalTotals\s*\)/.test(route) && route.includes('502'),
  'the /invoice handler fails closed when the canonical totals are unavailable',
);
// Any detail-row money reduction is gated to the Heritage override client (whose
// itemized rows come from a hand-maintained table, not billing_line_items, and
// are always complete). Every other client's money totals come from row? above,
// so a re-introduced capped reduction on the normal path would have to replace
// those canonical assertions — this is stronger than name-locking a variable.
assert(
  !route.includes('heritagePrepFeeRowsForRange') &&
    !route.includes('HERITAGE_PREP_FEE_CLIENT_NAME') &&
    !route.includes('const sumDetails ='),
  'the /invoice handler has no client-specific override or detail-row money reduction',
);
assert(
  route.includes('const orderedQty = details.reduce('),
  'only qty (a display count of the rendered line items) is summed from the details',
);
// No silent truncation: when the itemized list is genuinely row-capped, the
// invoice says the amount due is still complete rather than let visible lines
// under-sum it. Grains are aligned — real-order rows vs the canonical distinct-
// order count — and the always-complete override path never flags truncation.
assert(
  route.includes('details.filter((d) => d.orderId != null).length < invoiceTotals.orderCount') &&
    route.includes('details, truncated }'),
  'the /invoice handler flags a genuinely row-capped listing (grain-aligned) and passes it to the renderer',
);
assert(
  invoiceHtml.includes('truncated?: boolean') &&
    invoiceHtml.includes('const truncNote = truncated') &&
    invoiceHtml.includes('trunc-note') &&
    invoiceHtml.includes('${truncNote}'),
  'the printable invoice renders a truncation note when the itemized list is capped',
);

assert(
  pkg.scripts?.['test:client-portal-billing-totals'] === 'node scripts/client-portal-billing-totals-guard.mjs',
  'package exposes test:client-portal-billing-totals',
);

if (failed) process.exit(1);
console.log('\nclient portal billing totals guard passed.');

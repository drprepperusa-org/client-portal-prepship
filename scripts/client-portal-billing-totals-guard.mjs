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
assert(
  route.includes('const totals = rows.reduce('),
  'invoice-summary route computes grand totals backend-side (over the full SQL-aggregated set)',
);
assert(
  route.includes('return c.json({ data: rows, totals, billingVisible: true });'),
  'invoice-summary route returns the backend-owned totals alongside the rows',
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

// ── CP-024: the printable /invoice HTML's money totals are backend-owned too ──
// The amount-due and every section total must come from the canonical, uncapped
// billingSummary row — NEVER a reduction over the (row-capped) detail rows,
// which under-counts amount-due for a large invoice.
assert(
  route.includes('const summary = await billingSummary(') && route.includes('const row = summary.clients[0];'),
  'the /invoice handler derives its money totals from the canonical billingSummary (row)',
);
assert(
  route.includes('grandTotal: Number(row?.grandTotal') &&
    route.includes('pickPackTotal: Number(row?.pickPackTotal') &&
    route.includes('shippingTotal: Number(row?.shippingTotal') &&
    route.includes('storageTotal: Number(row?.storageTotal'),
  'the printable invoiceTotals source amount-due and every section total from the canonical row',
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

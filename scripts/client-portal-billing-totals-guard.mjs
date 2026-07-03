// CP-011 — Billing summary grand totals must be backend-owned. The Billing
// footer (Total row) previously reduced the per-period rows in React, which
// could drift from the printable invoice HTML, the Excel export, Finance, and
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
const invoices = read('portal-client/src/pages/Invoices.tsx');
const invoicesFlat = flat(invoices);
const api = flat(read('portal-client/src/lib/api.ts'));
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

// ── Frontend Billing renders backend totals — no row reduction for money ──
assert(
  invoicesFlat.includes('summaryQuery.data?.totals'),
  'Billing footer reads the backend-owned totals',
);
assert(
  !invoicesFlat.includes('summary.reduce(addBillingTotals') && !invoices.includes('function addBillingTotals'),
  'Billing no longer reduces the per-period rows into a grand total (addBillingTotals removed)',
);

// ── API type carries the backend totals ──
assert(
  api.includes('totals?: BillingInvoiceTotals') && api.includes('export interface BillingInvoiceTotals'),
  'the period-summary API response type exposes backend totals',
);

assert(
  pkg.scripts?.['test:client-portal-billing-totals'] === 'node scripts/client-portal-billing-totals-guard.mjs',
  'package exposes test:client-portal-billing-totals',
);

if (failed) process.exit(1);
console.log('\nclient portal billing totals guard passed.');

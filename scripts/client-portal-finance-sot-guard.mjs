// CP-012 — Finance's charge breakdown, total charges, billable-order count, and
// avg cost/order must be backend-owned so Finance renders them instead of
// reducing per-client rows (and can't drift from Billing). The /reports route
// scopes + computes everything; the frontend issues ONE request and renders it.
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

const route = flat(read('src/routes/client-portal.ts'));
const finance = flat(read('portal-client/src/pages/Finance.tsx'));
const api = read('portal-client/src/lib/api.ts');
const pkg = JSON.parse(read('package.json'));

// ── Backend /reports owns the Finance aggregates ──
assert(
  route.includes('const breakdown = [') && route.includes("key: 'pick_pack'") && route.includes("key: 'shipping'"),
  'reports route builds the charge breakdown backend-side',
);
assert(route.includes('const billableOrders = sumBy'), 'reports route computes billableOrders backend-side');
assert(
  route.includes('billableOrders > 0 ? totalCharges / billableOrders : 0'),
  'reports route computes avgCostPerOrder with a zero-orders guard',
);
assert(
  route.includes('breakdown,') && route.includes('billableOrders,') &&
    route.includes('avgCostPerOrder,') && route.includes('totalCharges,'),
  'reports response returns breakdown / billableOrders / avgCostPerOrder / totalCharges',
);
assert(
  route.includes('if (!scope.canViewFinancials)') && route.includes('billingVisible: false'),
  'reports redacts (billingVisible:false) when the caller cannot view financials',
);

// ── Frontend Finance renders backend values, reduces nothing ──
assert(finance.includes('query.data?.breakdown'), 'Finance renders the backend breakdown');
assert(
  finance.includes('num(query.data?.avgCostPerOrder)') && finance.includes('num(query.data?.billableOrders)'),
  'Finance renders backend avgCostPerOrder + billableOrders',
);
assert(
  !/rows\.reduce\(\(n, r\) => n \+ num\(r\.(pickPackTotal|packageTotal|shippingTotal|storageTotal|orderCount)/.test(finance),
  'Finance no longer reduces per-client rows into charge totals or an order count',
);
assert(
  !finance.includes('orders ? totalCharges / orders'),
  'Finance no longer computes avg cost/order in React',
);

// ── ONE scoped request — no per-client fan-out/merge in scopedReports ──
const scoped = api.match(/async function scopedReports\([\s\S]*?\n\}/)?.[0] ?? '';
assert(scoped.length > 0, 'scopedReports located');
assert(
  !/scope\.clientIds\.map\(/.test(scoped) && !scoped.includes('pages.flatMap'),
  'scopedReports issues ONE scoped request (no per-client fan-out/merge that recomputes totals)',
);

assert(
  pkg.scripts?.['test:client-portal-finance-sot'] === 'node scripts/client-portal-finance-sot-guard.mjs',
  'package exposes test:client-portal-finance-sot',
);

if (failed) process.exit(1);
console.log('\nclient portal finance SOT guard passed.');

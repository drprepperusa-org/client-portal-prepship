// Sales SOT drift guard — makes "the frontend must not compute an authoritative
// money/units KPI" a build-time invariant, not a discipline. Every drift bug
// this cycle (CP-010 revenue, CP-012 Finance, CP-011 Billing footer) was the
// same shape: a React `.reduce(...)` summing a money field the backend already
// owns. This fails the build if that shape reappears on ANY client-portal page.
//
// Escape hatch: add `drift-guard-allow` in a comment on the reduce line if a
// reduction is genuinely display-only (rare — justify it).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

// ── The one canonical owner exists and both KPI screens consume it ──
const analysis = read('src/routes/analysis.ts');
assert(
  analysis.includes('export async function getClientPortalSalesTotals') &&
    analysis.includes('export async function getClientPortalDailyRevenue'),
  'the canonical sales-metrics owner (getClientPortalSalesTotals + daily) exists',
);
// /dashboard (getClientPortalSalesTotals) and /analysis (totalRevenue) live in
// separate sub-routers post-decomposition — concat both into one scan string.
const route = (read('src/routes/client-portal/dashboard.ts') + '\n' + read('src/routes/client-portal/analysis.ts')).replace(/\s+/g, ' ');
assert(
  route.includes('getClientPortalSalesTotals(salesQuery)') && route.includes('totalRevenue: result.totalRevenue'),
  '/dashboard + /analysis routes consume the canonical owner (no route-local revenue reduction)',
);

// ── No client-portal page/component reduces rows into a money/units KPI ──
// These are the fields the backend now owns; a `.reduce(...)` over any of them
// on a page means React is re-deriving an authoritative total.
const MONEY_FIELDS = [
  'orderTotal', 'order_total', 'total_revenue', 'total_qty',
  'pickPackTotal', 'pickpackTotal', 'packageTotal', 'shippingTotal',
  'storageTotal', 'additionalTotal', 'rowTotal', 'grandTotal',
  'orderCount', 'unit_price', 'unitPrice',
];
const scanFiles = [
  ...fs
    .readdirSync(path.join(root, 'portal-client/src/pages'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `portal-client/src/pages/${f}`),
  'portal-client/src/components/OrderDetailPanel.tsx',
];

let violations = 0;
for (const rel of scanFiles) {
  const src = read(rel);
  for (const field of MONEY_FIELDS) {
    // `.reduce( … <field>` within one statement (not crossing a `;`, so the
    // window can't bleed into unrelated following code).
    const re = new RegExp(`\\.reduce\\s*\\([^;]{0,220}?\\b${field}\\b`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      let lineEnd = src.indexOf('\n', m.index);
      if (lineEnd === -1) lineEnd = src.length;
      const line = src.slice(lineStart, lineEnd);
      if (line.includes('drift-guard-allow') || m[0].includes('drift-guard-allow')) continue;
      console.error(`FAIL ${rel}: .reduce over money field "${field}" — read the backend-owned total instead (or mark drift-guard-allow with justification)`);
      violations += 1;
      failed = true;
    }
  }
}
assert(
  violations === 0,
  'no client-portal page/component reduces rows into an authoritative money/units KPI',
);

const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-sales-sot-drift'] === 'node scripts/client-portal-sales-sot-drift-guard.mjs',
  'package exposes test:client-portal-sales-sot-drift',
);

if (failed) process.exit(1);
console.log('\nclient portal sales SOT drift guard passed.');

import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-031 — Client-portal Billing "returns are a visible category" guard.
//
// The backend already generates `return_postage` / `return_processing_fee`
// billing_line_items (pinned by scripts/return-billing-guard.mjs). This guard
// pins the OTHER half Hermes flagged: the ACTIVE client-portal invoice surfaces
// must break those return charges out as explicit categories instead of folding
// them invisibly into the generic grand total ("Fulfillment Fee"). It covers:
//   1. The invoice read-model (summary / period / detail) sums return_postage +
//      return_processing_fee into backend-owned returnPostageTotal /
//      returnProcessingTotal fields — WITHOUT changing the canonical rowTotal.
//   2. The /invoice-summary route exposes those return totals in its backend-
//      owned grand-totals object.
//   3. The frontend API types carry the fields.
//   4. Invoices.tsx renders return columns in BOTH the summary and detail tables,
//      mapped from the backend fields (no React arithmetic — SOT law).
//   5. The Excel export includes the two return columns (line + totals rows).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) =>
  fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS ${msg}`);
  } else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}
const count = (src, re) => (src.match(re) || []).length;

const readModel = read('src/lib/client-portal/read-models/invoice-details.ts');
const route = read('src/routes/client-portal/invoices.ts');
const api = readActiveClientPortalApiSource();
const page = readSourceTree([
  'portal-client/src/pages/Invoices.tsx',
  'portal-client/src/components/billing/invoiceColumns.tsx',
  'portal-client/src/components/billing/invoices',
]);
const excel = read('portal-client/src/lib/invoiceExcel.ts');
const pkg = JSON.parse(read('package.json'));

// ── 1. Read-model: backend-owned return aggregates in all three queries ──
assert(readModel.length > 0, 'the invoice-details read-model exists');
assert(
  count(readModel, /line_type = 'return_postage' then b\.total_cost/g) >= 3,
  'summary + period + detail each SUM return_postage from billing_line_items (backend-owned)',
);
assert(
  count(readModel, /line_type = 'return_processing_fee' then b\.total_cost/g) >= 3,
  'summary + period + detail each SUM return_processing_fee from billing_line_items (backend-owned)',
);
assert(
  count(readModel, /returnPostageTotal: row\.returnpostage_total/g) >= 3,
  'the read-model maps returnPostageTotal in all three projections',
);
assert(
  count(readModel, /returnProcessingTotal: row\.returnprocessing_total/g) >= 3,
  'the read-model maps returnProcessingTotal in all three projections',
);
// SOT: the canonical grand total (row_total) is STILL sum(b.total_cost) over
// ALL line types — the return breakout must not alter it (returns were already
// inside it). So row_total is never re-derived by subtracting/adding returns.
assert(
  /coalesce\(sum\(b\.total_cost\), 0\)::text as row_total/.test(readModel),
  'row_total remains the canonical sum(total_cost) over all line types (returns already included, not double-counted)',
);

// ── 2. /invoice-summary route exposes the return totals in its grand totals ──
assert(
  /returnPostageTotal: acc\.returnPostageTotal \+ Number\(r\.returnPostageTotal/.test(route) &&
    /returnProcessingTotal: acc\.returnProcessingTotal \+ Number\(r\.returnProcessingTotal/.test(route),
  'the /invoice-summary route folds returnPostageTotal + returnProcessingTotal into its backend-owned totals',
);
assert(
  /returnPostageTotal: 0, returnProcessingTotal: 0/.test(route),
  'the totals reducer initializes the return fields',
);

// ── 3. Frontend API types carry the fields ──
for (const iface of ['BillingInvoiceSummaryRow', 'BillingInvoiceTotals', 'BillingInvoiceDetailRow']) {
  const m = api.match(new RegExp(`export interface ${iface}\\s*\\{[\\s\\S]*?\\n\\}`));
  const block = m ? m[0] : '';
  assert(
    /returnPostageTotal/.test(block) && /returnProcessingTotal/.test(block),
    `${iface} exposes returnPostageTotal + returnProcessingTotal`,
  );
}

// ── 4. Invoices.tsx renders return columns, mapped from backend fields ──
assert(
  /moneyColumn\(\s*'returnPostage',\s*'Return Postage'/.test(page) &&
    /moneyColumn\(\s*'returnProcessing',\s*'Return Processing'/.test(page) &&
    /invoiceMoneyColumn\(\s*'returnpostage',\s*'Return Postage'/.test(page) &&
    /invoiceMoneyColumn\(\s*'returnprocessing',\s*'Return Processing'/.test(page),
  'the Billing tables render Return Postage + Return Processing columns',
);
// Both a summary column (PeriodSummary) and a detail line column exist.
assert(
  count(page, /'Return Postage'/g) >= 2 && count(page, /'Return Processing'/g) >= 2,
  'the return columns appear in BOTH the period-summary table and the line-item detail table',
);
// The numbers are read from the backend DTO fields — no React arithmetic.
assert(
  /returnPostage: numberValue\(row\.returnPostageTotal\)/.test(page) &&
    /returnProcessing: numberValue\(row\.returnProcessingTotal\)/.test(page),
  'the summary rows map return totals from the backend DTO (num(r.returnPostageTotal)), not computed in React',
);
assert(
  /returnPostage: numberValue\(value\.returnPostageTotal\)/.test(page) &&
    /returnProcessing: numberValue\(value\.returnProcessingTotal\)/.test(page),
  'the footer totals map return totals from the backend totals object (num(t.returnPostageTotal))',
);
// SOT: the grand total column still reads the backend rowTotal, never a React
// re-sum of the category columns.
assert(
  /fee: numberValue\(row\.rowTotal\)/.test(page) &&
    /fee: numberValue\(value\.rowTotal\)/.test(page),
  'the Fulfillment Fee (grand total) is still the backend rowTotal (no React re-sum of categories)',
);

// ── 5. Excel export includes the two return columns (line + totals rows) ──
assert(
  /'Return Postage'/.test(excel) && /'Return Processing'/.test(excel),
  'the Excel export header includes Return Postage + Return Processing',
);
// CP-059 AC-5. This used to pin `num(r.returnPostageTotal)` — but num() collapses null to 0,
// which is exactly the coercion that made an absent return line indistinguishable from a real
// $0.00 one in the export. The check is now STRONGER, not merely updated: it requires the
// presence-aware cell AND forbids the raw num() coercion coming back on either return column.
assert(
  /moneyCellOrBlank\(r\.hasReturnPostageLine, r\.returnPostageTotal\)/.test(excel) &&
    /moneyCellOrBlank\(r\.hasReturnProcessingLine, r\.returnProcessingTotal\)/.test(excel),
  'the Excel data rows include the return totals, keyed on upstream fee presence',
);
assert(
  !/num\(r\.returnPostageTotal\)/.test(excel) && !/num\(r\.returnProcessingTotal\)/.test(excel),
  'return money must NOT go through num(), which would render an absent line as a fabricated 0.00',
);
assert(
  /sum\(\(r\) => r\.returnPostageTotal\)/.test(excel) && /sum\(\(r\) => r\.returnProcessingTotal\)/.test(excel),
  'the Excel totals row sums the return columns',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-billing-returns-display'] ===
    'node scripts/client-portal-billing-returns-display-guard.mjs',
  'package.json exposes test:client-portal-billing-returns-display',
);

if (failed) process.exit(1);
console.log('\nCP-031 client-portal Billing returns-display guard passed.');

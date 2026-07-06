// Client Portal Analysis order-combinations guard.
//
// This metric is customer-visible business data, so the portal must render a
// backend-owned read model from orders/order_items rather than grouping rows in
// React. The section should sit below the SKU table and display the returned
// combinations verbatim.
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

const analysisRoute = read('src/routes/analysis.ts');
const clientPortalAnalysisRoute = read('src/routes/client-portal/analysis.ts');
const api = read('portal-client/src/lib/api.ts');
const page = read('portal-client/src/pages/Analysis.tsx');
const pageFlat = flat(page);
const pkg = JSON.parse(read('package.json'));

assert(
  analysisRoute.includes('export async function getOrderCombinationsFromOrderItems'),
  'analysis.ts exports the backend-owned order-combinations read model',
);
assert(
  analysisRoute.includes('orderCombinationsSourceInputs') &&
    analysisRoute.includes('orders.order_date') &&
    analysisRoute.includes('order_items.quantity'),
  'order-combinations read model documents source inputs and event clock',
);
assert(
  analysisRoute.includes('combination_key') &&
    analysisRoute.includes('jsonb_agg') &&
    analysisRoute.includes('count(*)::int as order_count') &&
    analysisRoute.includes('sum(total_units)::int as total_units'),
  'order-combinations query groups canonical order_items into per-order SKU mixes',
);
assert(
  analysisRoute.includes('and ${analysisOrderScopePredicate(q)}') &&
    analysisRoute.includes('and (${cid}::int is null or o.client_id = ${cid}::int)'),
  'order-combinations query applies the same Analysis client/store scope',
);
assert(
  clientPortalAnalysisRoute.includes('orderCombinations: result.orderCombinations'),
  '/api/client-portal/analysis returns backend-owned orderCombinations',
);
assert(
  api.includes('export interface AnalysisOrderCombination') &&
    api.includes('orderCombinations?: AnalysisOrderCombination[]'),
  'portal API type exposes orderCombinations on AnalysisBreakdown',
);
assert(
  page.includes('const orderCombinations = analysis.data?.orderCombinations ?? []') &&
    page.includes('Order combinations') &&
    page.includes('Combination') &&
    page.includes('Orders'),
  'Analysis page renders the backend order-combinations section',
);
assert(
  !/orderCombinations\s*=\s*rows[\s\S]*?\.reduce/.test(pageFlat) &&
    !/rows[\s\S]*?\.reduce[\s\S]*?orderCombinations/.test(pageFlat),
  'Analysis page does not derive order combinations by reducing SKU rows',
);
assert(
  pkg.scripts?.['test:client-portal-analysis-order-combinations'] ===
    'node scripts/client-portal-analysis-order-combinations-guard.mjs',
  'package exposes test:client-portal-analysis-order-combinations',
);

if (failed) process.exit(1);
console.log('\nclient portal analysis order-combinations guard passed.');

import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-046 - Analysis Pending must use the Orders awaiting-shipment SOT.
//
// Customer-visible Analysis pending is not "missing shipping billing" and not
// "missing label cost". It is the count of visible awaiting-shipment orders that
// contain the SKU, using the same Orders read-model semantics as the Orders tab
// and sidebar badge.
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

const analysis = read('src/routes/analysis.ts');
const analysisFlat = flat(analysis);
const predicates = read('src/lib/client-portal/predicates.ts');
const predicatesFlat = flat(predicates);
const ordersReadModel = read('src/lib/client-portal/read-models/orders.ts');
const api = readActiveClientPortalApiSource();
const integration = read('scripts/integration/client-portal.integration.ts');
const pkg = JSON.parse(read('package.json'));

const pendingSelectMatch = analysisFlat.match(/count\(\*\)::int\s+as orders,\s+([\s\S]{0,500}?)\s+as pending,/);
const pendingSelect = pendingSelectMatch?.[1] ?? '';

assert(
  predicates.includes('export function rawVisibleAwaitingOrdersPredicateForAlias'),
  'predicates.ts exports an alias-safe visible awaiting-order predicate for raw SQL',
);
assert(
  predicatesFlat.includes("coalesce(o.order_number, '') ilike 'SEAuto-%'") &&
    predicatesFlat.includes("coalesce(o.raw->>'orderNumber', '') ilike 'SEAuto-%'") &&
    predicatesFlat.includes('jsonb_array_length') &&
    predicatesFlat.includes('from order_items visible_item'),
  'alias-safe predicate preserves the Orders hidden SEAuto/no-item placeholder suppression',
);
assert(
  ordersReadModel.includes('eq(orders.orderStatus, \'awaiting_shipment\')') &&
    ordersReadModel.includes('visibleAwaitingOrdersPredicate()'),
  'Orders awaiting read-model remains the canonical SOT for awaiting counts',
);
assert(
  analysis.includes('rawVisibleAwaitingOrdersPredicateForAlias'),
  'Analysis imports/reuses the alias-safe Orders awaiting visibility predicate',
);
assert(
  /coalesce\(o\.order_status,\s*''\)\s*=\s*'awaiting_shipment'/.test(analysis) ||
    /o\.order_status\s*=\s*'awaiting_shipment'/.test(analysis),
  'Analysis pending checks orders.order_status = awaiting_shipment',
);
assert(
  /as is_awaiting_order/.test(analysis),
  'Analysis carries an explicit is_awaiting_order flag from item rows to SKU rows',
);
assert(
  /count\(\*\)\s+filter\s*\(\s*where\s+is_awaiting_order\s*\)::int\s+as pending/.test(analysisFlat),
  'Analysis pending is counted from is_awaiting_order, not derived from shipping/billing math',
);
assert(
  pendingSelect.length > 0,
  'guard can isolate the SQL pending select expression',
);
assert(
  !/\blabel_cost\b|\bship_class\b|\bis_external\b|billing_line_items|line_type\s*=\s*'shipping'/.test(pendingSelect),
  'pending select expression does not reference label_cost, ship buckets, external shipping, or billing shipping lines',
);
assert(
  /pending: number;/.test(api) &&
    /awaiting-shipment orders containing this SKU/.test(api),
  'AnalysisSkuRow.pending is required and documented as awaiting-shipment orders containing the SKU',
);
assert(
  integration.includes('Group 6 - CP-046 Analysis pending awaiting-order SOT') &&
    integration.includes("orderStatus: 'awaiting_shipment'") &&
    integration.includes("orderStatus: 'shipped'") &&
    integration.includes('shippingBasis: \'customer_billed\'') &&
    integration.includes('SEAuto-CP046'),
  'integration fixture covers awaiting SKU, shipped/no-billing SKU, customer_billed basis, and hidden SEAuto placeholder',
);
assert(
  pkg.scripts?.['test:client-portal-analysis-pending-sot'] ===
    'node scripts/client-portal-analysis-pending-sot-guard.mjs',
  'package exposes test:client-portal-analysis-pending-sot',
);

if (failed) process.exit(1);
console.log('\nCP-046 Analysis pending SOT guard passed.');

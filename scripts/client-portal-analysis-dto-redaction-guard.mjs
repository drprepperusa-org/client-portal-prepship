import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-047/CP-050: both Client Portal Analysis routes must expose explicit
// customer-safe contracts. Shared operator fields cannot cross either API or
// frontend type boundary.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const route = read('src/routes/client-portal/analysis.ts');
const api = readActiveClientPortalApiSource();
const sharedOwner = read('src/routes/analysis.ts');
const bundleGuard = read('scripts/client-portal-bundle-redaction-guard.mjs');
const analysisPage = read('portal-client/src/pages/Analysis.tsx');
const pkg = JSON.parse(read('package.json'));

const approvedFields = [
  'sku',
  'name',
  'image_url',
  'inv_sku_id',
  'client_id',
  'client_name',
  'orders',
  'pending',
  'total_qty',
  'total_revenue',
  'daily_qty',
];
const forbiddenFields = [
  'ext_shipped',
  'std_orders',
  'std_ship_count',
  'std_total',
  'std_qty_total',
  'exp_orders',
  'exp_ship_count',
  'exp_total',
  'exp_qty_total',
  'ship_count_with_cost',
  'total_shipping',
  'total_selling_fee',
  'billedShippingTotal',
];
const skuOrdersTopLevelFields = [
  'sku',
  'name',
  'totalUnits',
  'avgShippingStandard',
  'avgShippingExpedited',
  'averageUnitsPerDay',
  'dailySales',
  'orders',
];
const skuOrderFields = [
  'order_id',
  'order_number',
  'order_date',
  'order_status',
  'ship_to_name',
  'qty',
  'unit_price',
  'item_name',
  'shippingTotal',
  'shippingStandard',
  'shippingExpedited',
  'shippingMoneyState',
];
// CP-060: shipping_total/standard/expedited/money_state are the APPROVED
// source columns the serializer maps from; everything else stays forbidden,
// including the retired std-only generics.
const skuOrderApprovedSourceColumns = [
  'shipping_total',
  'shipping_standard',
  'shipping_expedited',
  'shipping_money_state',
];
const skuOrdersForbiddenFields = [
  'clientId',
  'shipCountStandard',
  'shipCountExpedited',
  'shippingStandardTotal',
  'shippingExpeditedTotal',
  'shippingCharge',
  'avgShippingCharge',
  'carrier_code',
  'service_code',
  'shipping_cost',
  'standard_shipping_cost',
  'standard_shipping_total',
  'is_external_shipped',
];

const dtoMatch = route.match(
  /export function toClientAnalysisRow[\s\S]*?return \{([\s\S]*?)\r?\n  \};\r?\n\}/,
);
const dtoBody = dtoMatch?.[1] ?? '';
const dtoFields = [...dtoBody.matchAll(/^\s+([a-z_]+):/gm)].map((match) => match[1]);
assert(Boolean(dtoMatch), 'Client Portal Analysis route defines a dedicated row serializer');
assert(!dtoBody.includes('...'), 'customer row serializer uses no object spread');
assert(
  JSON.stringify(dtoFields) === JSON.stringify(approvedFields),
  `customer row serializer emits only the approved whitelist (${approvedFields.join(', ')})`,
);
assert(
  forbiddenFields.every((field) => !dtoBody.includes(field)),
  'customer row serializer excludes internal shipping, fee, and debug fields',
);
assert(
  route.includes('total_revenue: canViewFinancials ? row.total_revenue : \'0\''),
  'per-SKU revenue remains financially redacted at the backend boundary',
);
assert(
  route.includes('pending: row.pending') &&
    route.includes('result.rows.map((row) => toClientAnalysisRow(row, scope.canViewFinancials))'),
  'CP-046 pending truth passes through the whitelist without re-derivation',
);

const typeMatch = api.match(/export interface AnalysisSkuRow \{([\s\S]*?)\n\}/);
const typeBody = typeMatch?.[1] ?? '';
const typeFields = [...typeBody.matchAll(/^\s+([a-z_]+)[?]?:/gm)].map((match) => match[1]);
assert(Boolean(typeMatch), 'frontend declares the customer AnalysisSkuRow contract');
assert(
  JSON.stringify(typeFields) === JSON.stringify(approvedFields),
  'frontend AnalysisSkuRow exactly mirrors the backend whitelist',
);
assert(
  forbiddenFields.every((field) => !typeBody.includes(field)),
  'frontend customer type excludes every forbidden internal Analysis field',
);

const skuOrderDtoMatch = route.match(
  /export function toClientAnalysisSkuOrderDto[\s\S]*?return \{([\s\S]*?)\r?\n  \};\r?\n\}/,
);
const skuOrderDtoBody = skuOrderDtoMatch?.[1] ?? '';
const skuOrderDtoFields = [...skuOrderDtoBody.matchAll(/^\s+([A-Za-z_]+):/gm)].map((match) => match[1]);
assert(Boolean(skuOrderDtoMatch), 'SKU-order route defines a dedicated per-order serializer');
assert(!skuOrderDtoBody.includes('...'), 'SKU-order serializer uses no object spread');
assert(
  JSON.stringify(skuOrderDtoFields) === JSON.stringify(skuOrderFields),
  'SKU-order serializer emits only approved customer order fields',
);
assert(
  skuOrdersForbiddenFields.every((field) => !skuOrderDtoBody.includes(field)) &&
    skuOrderDtoBody.includes('shippingTotal: order.shipping_total') &&
    skuOrderDtoBody.includes('shippingStandard: order.shipping_standard') &&
    skuOrderDtoBody.includes('shippingExpedited: order.shipping_expedited') &&
    skuOrderDtoBody.includes('shippingMoneyState: order.shipping_money_state') &&
    skuOrderApprovedSourceColumns.length === 4,
  'SKU-order serializer maps only the approved per-class customer shipping fields',
);

const skuOrdersDtoMatch = route.match(
  /export function toClientAnalysisSkuOrdersDto[\s\S]*?return \{([\s\S]*?)\r?\n  \};\r?\n\}/,
);
const skuOrdersDtoBody = skuOrdersDtoMatch?.[1] ?? '';
const skuOrdersDtoFields = [...skuOrdersDtoBody.matchAll(/^\s+([A-Za-z_]+):/gm)].map((match) => match[1]);
assert(Boolean(skuOrdersDtoMatch), 'SKU-orders route defines a dedicated top-level serializer');
assert(!skuOrdersDtoBody.includes('...'), 'SKU-orders top-level serializer uses no object spread');
assert(
  JSON.stringify(skuOrdersDtoFields) === JSON.stringify(skuOrdersTopLevelFields),
  'SKU-orders top-level serializer emits only approved customer fields',
);
assert(
  route.includes('dailySales: result.dailySales.map((point) => ({ day: point.day, units: point.units }))') &&
    route.includes('orders: result.orders.map(toClientAnalysisSkuOrderDto)'),
  'nested daily-sales and order arrays are explicitly serialized',
);
assert(
  route.includes('return c.json(toClientAnalysisSkuOrdersDto(result));'),
  'SKU-orders HTTP response uses the dedicated customer DTO',
);

const skuOrderTypeMatch = api.match(/export interface SkuOrderRow \{([\s\S]*?)\r?\n\}/);
const skuOrderTypeBody = skuOrderTypeMatch?.[1] ?? '';
const skuOrderTypeFields = [...skuOrderTypeBody.matchAll(/^\s+([A-Za-z_]+)[?]?:/gm)].map((match) => match[1]);
assert(Boolean(skuOrderTypeMatch), 'frontend declares the customer SkuOrderRow contract');
assert(
  JSON.stringify(skuOrderTypeFields) === JSON.stringify(skuOrderFields),
  'frontend SkuOrderRow exactly mirrors the backend whitelist',
);

const skuOrdersTypeMatch = api.match(/export interface SkuOrdersResult \{([\s\S]*?)\r?\n\}/);
const skuOrdersTypeBody = skuOrdersTypeMatch?.[1] ?? '';
const skuOrdersTypeFields = [...skuOrdersTypeBody.matchAll(/^\s+([A-Za-z_]+)[?]?:/gm)].map((match) => match[1]);
assert(Boolean(skuOrdersTypeMatch), 'frontend declares the customer SkuOrdersResult contract');
assert(
  JSON.stringify(skuOrdersTypeFields) === JSON.stringify(skuOrdersTopLevelFields),
  'frontend SkuOrdersResult exactly mirrors the backend whitelist',
);
assert(
  skuOrdersForbiddenFields.every(
    (field) => !skuOrderTypeBody.includes(field) && !skuOrdersTypeBody.includes(field),
  ),
  'frontend SKU-order types exclude internal shipment fields',
);
assert(
  analysisPage.includes('data?.averageUnitsPerDay') &&
    !analysisPage.includes('data.totalUnits / data.dailySales.length'),
  'Avg / day renders the intent-named backend DTO field',
);
assert(
  analysisPage.includes('CP-050 allowlisted presentation formula') &&
    analysisPage.includes('money(num(r.total_revenue) / qty)'),
  'Avg Sell Price is an explicit presentation formula over canonical backend inputs',
);

assert(
  forbiddenFields.filter((field) => field !== 'billedShippingTotal').every((field) => sharedOwner.includes(field)),
  'shared backend owner retains operator metrics; CP-047 narrows only the customer boundary',
);
assert(
  ['ext_shipped', 'std_ship_count', 'std_total', 'exp_ship_count', 'exp_total', 'ship_count_with_cost', 'total_selling_fee']
    .every((field) => bundleGuard.includes(`'${field}'`)),
  'compiled customer bundle guard rejects internal Analysis field names',
);
assert(
  ['standardShipCount', 'standardShippingTotal', 'is_external_shipped', 'carrier_code', 'service_code']
    .every((field) => bundleGuard.includes(`'${field}'`)),
  'compiled customer bundle guard rejects SKU-order shipment vocabulary',
);
assert(
  pkg.scripts?.['test:client-portal-analysis-dto-redaction'] ===
    'node scripts/client-portal-analysis-dto-redaction-guard.mjs && tsx scripts/client-portal-analysis-sku-orders-dto-runtime.ts',
  'package exposes test:client-portal-analysis-dto-redaction',
);

if (failed) process.exit(1);
console.log('\nCP-047/CP-050 Client Portal Analysis DTO redaction guard passed.');

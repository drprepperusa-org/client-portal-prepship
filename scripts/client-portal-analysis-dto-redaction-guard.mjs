// CP-047: the Client Portal Analysis API must expose an explicit customer-safe
// row contract. Internal operator metrics may remain in the shared backend
// owner, but they cannot cross the customer route or frontend type boundary.
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
const api = read('portal-client/src/lib/api.ts');
const sharedOwner = read('src/routes/analysis.ts');
const bundleGuard = read('scripts/client-portal-bundle-redaction-guard.mjs');
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

const dtoMatch = route.match(
  /export function toClientAnalysisRow[\s\S]*?return \{([\s\S]*?)\n  \};\n\}/,
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
  pkg.scripts?.['test:client-portal-analysis-dto-redaction'] ===
    'node scripts/client-portal-analysis-dto-redaction-guard.mjs',
  'package exposes test:client-portal-analysis-dto-redaction',
);

if (failed) process.exit(1);
console.log('\nCP-047 Client Portal Analysis DTO redaction guard passed.');

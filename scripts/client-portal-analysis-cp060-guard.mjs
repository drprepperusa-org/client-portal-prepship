// CP-060 guard — per-shipment shipping classification stays single-sourced and
// the SKU drawer read model never regresses to newest-label classification.
//
// Pins:
//   1. src/lib/shipping-class.ts holds EXACTLY the 13 canonical expedited
//      services (mirror of prepship-v4 REPORTING_EXPEDITED_SERVICES, PS-418).
//   2. That file is the ONLY definition of EXPEDITED_SERVICES in src/.
//   3. sku-orders.ts imports the shared list and contains no newest-label
//      classifier (`order by s.id desc` was the pre-CP-060 bug).
//   4. routes/analysis.ts consumes the shared list.
//   5. The client contract exposes the per-class fields + money state and the
//      retired std-only generic names stay dead.
//   6. The route DTO maps the money state and no longer reads the retired
//      std-only source column.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}

function read(path) {
  return readFileSync(path, 'utf8');
}

// Strip line + block comments so commented-out code can't satisfy or trip us.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CANONICAL_EXPEDITED = [
  'ups_2nd_day_air', 'ups_2nd_day_air_am',
  'ups_next_day_air', 'ups_next_day_air_saver', 'ups_next_day_air_early_am',
  'ups_3_day_select',
  'usps_priority_mail_express',
  'fedex_2day', 'fedex_2day_am',
  'fedex_express_saver',
  'fedex_priority_overnight', 'fedex_standard_overnight', 'fedex_first_overnight',
];

// 1. Shared module holds exactly the canonical list.
const shippingClass = stripComments(read('src/lib/shipping-class.ts'));
const arrayMatch = shippingClass.match(/EXPEDITED_SERVICES = \[([\s\S]*?)\]/);
check(Boolean(arrayMatch), 'shipping-class.ts defines EXPEDITED_SERVICES');
if (arrayMatch) {
  const listed = [...arrayMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check(
    JSON.stringify([...listed].sort()) === JSON.stringify([...CANONICAL_EXPEDITED].sort()),
    `shared list matches the 13 canonical PS-418 services (got ${listed.length})`,
  );
}

// 2. Single definition across src/.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}
const definitionFiles = walk('src').filter((path) =>
  /EXPEDITED_SERVICES = \[/.test(stripComments(read(path))),
);
check(
  definitionFiles.length === 1 && definitionFiles[0].replace(/\\/g, '/') === 'src/lib/shipping-class.ts',
  `exactly one EXPEDITED_SERVICES definition, in shipping-class.ts (found: ${definitionFiles.join(', ') || 'none'})`,
);

// 3. sku-orders consumes the shared list and has no newest-label classifier.
const skuOrders = stripComments(read('src/services/sku-orders.ts'));
check(
  skuOrders.includes("from '../lib/shipping-class'"),
  'sku-orders imports the shared classification list',
);
check(
  !/order by s\.id desc/i.test(skuOrders),
  'sku-orders contains no newest-label (`order by s.id desc`) classifier',
);
check(
  skuOrders.includes('billing_line_items b') && skuOrders.includes('b.shipment_id = s.id'),
  'sku-orders attributes billed money per shipment via billing_line_items.shipment_id',
);
check(
  skuOrders.includes('shipping_money_state'),
  'sku-orders emits an explicit shipping_money_state',
);

// 4. The analysis route consumes the shared list.
const analysisRoute = stripComments(read('src/routes/analysis.ts'));
check(
  analysisRoute.includes("from '../lib/shipping-class'"),
  'routes/analysis.ts consumes the shared classification list',
);

// 5. Contract shape.
const contract = stripComments(read('src/lib/client-portal/contracts/analysis.ts'));
for (const field of ['shippingMoneyState', 'shippingStandard', 'shippingExpedited', 'shippingTotal', 'avgShippingStandard', 'avgShippingExpedited']) {
  check(contract.includes(field), `contract exposes ${field}`);
}
for (const retired of ['shippingCharge', 'avgShippingCharge']) {
  check(!contract.includes(retired), `contract no longer exposes retired ${retired}`);
}

// 6. Route DTO mapping.
const portalRoute = stripComments(read('src/routes/client-portal/analysis.ts'));
check(
  portalRoute.includes('shipping_money_state'),
  'portal analysis route maps shipping_money_state into the DTO',
);
check(
  !portalRoute.includes('standard_shipping_cost'),
  'portal analysis route no longer reads the retired std-only source column',
);

if (failures > 0) {
  console.error(`\n✖ CP-060 guard: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\nPASS CP-060 per-shipment shipping classification guard');

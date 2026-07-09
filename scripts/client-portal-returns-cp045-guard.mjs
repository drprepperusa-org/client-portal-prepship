// CP-045 - Return labels use PrepShip best rate, fixed DRP return address,
// exact outbound package facts, persisted return reference, and client-safe
// inspection/download visibility.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const service = read('src/services/returns.ts');
const route = read('src/routes/client-portal/returns.ts');
const schema = read('src/db/schema/returns.ts');
const shipmentSchema = read('src/db/schema/shipments.ts');
const api = read('portal-client/src/lib/api.ts');
const returnApi = stripComments(
  api.slice(
    api.indexOf('export interface PortalReturnRow'),
    api.indexOf('// CP-030', api.indexOf('export interface PortalReturnRow')),
  ),
);
const createModal = read('portal-client/src/components/returns/ReturnCreateModal.tsx');
const returnsPage = read('portal-client/src/pages/Returns.tsx');
const receiving = read('portal-client/src/components/returns/ReturnReceivingModal.tsx');
const migrations = fs.existsSync(path.join(root, 'drizzle'))
  ? fs
      .readdirSync(path.join(root, 'drizzle'))
      .filter((file) => file.endsWith('.sql'))
      .map((file) => fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'))
      .join('\n')
  : '';
const pkg = JSON.parse(read('package.json'));

assert(service.length > 0, 'src/services/returns.ts exists');
assert(route.length > 0, 'src/routes/client-portal/returns.ts exists');

// 1. Fixed return-to address: every label ships TO DR PREPPER LLC in Gardena.
assert(
  /DRP_RETURN_TO_ADDRESS/.test(service),
  'return-label service defines one fixed DRP return-to address owner',
);
for (const value of ['DR PREPPER LLC', '413 W Walnut St', 'Gardena', 'CA', '90248']) {
  assert(service.includes(value), `fixed DRP return-to address includes ${value}`);
}
assert(
  /const shipTo = DRP_RETURN_TO_ADDRESS/.test(service),
  'createReturnLabel uses the fixed DRP return-to address as shipTo',
);
assert(
  !/locationToAddress\(|getDefaultLocation\(|returnRow\?\.returnToLocationId/.test(service),
  'return-label service no longer resolves return-to from selectable/default locations',
);

// 2. Sender/from comes from original recipient/customer address.
assert(
  /const shipFrom = orderShipToFromRaw\(order\)/.test(service),
  'return sender/from address is copied from the original order recipient/ship-to',
);
assert(
  /assertAddressComplete\(shipFrom,\s*'ship-from \(customer\)'\)/.test(service),
  'customer sender/from address is validated before label creation',
);

// 3. Package facts copy exactly from the outbound shipment and missing facts block.
assert(
  shipmentSchema.includes('selectedPackageId'),
  'shipments has selectedPackageId as the existing outbound package owner',
);
assert(
  /assertOutboundReturnPackage\(outbound\)/.test(service),
  'return-label service validates outbound weight/dims/package before rating or labeling',
);
assert(
  /Missing outbound shipment return-label facts/.test(service),
  'missing outbound package/weight/dims produces a clear blocking error',
);
assert(
  !/outbound\.weightOz\s*\?\?\s*order\.weightOz\s*\?\?\s*1/.test(service),
  'return-label service does not guess weight from order/default fallback',
);
assert(
  /weightOz:\s*args\.outbound\.weightOz/.test(service) &&
    /dimsL:\s*args\.outbound\.dimsL/.test(service) &&
    /dimsW:\s*args\.outbound\.dimsW/.test(service) &&
    /dimsH:\s*args\.outbound\.dimsH/.test(service) &&
    /selectedPackageId:\s*args\.outbound\.selectedPackageId/.test(service),
  'return shipment persists exact outbound weight/dims/package facts',
);
assert(
  /packageCode:\s*outbound\.selectedPackageId/.test(service),
  'live label purchase sends the exact outbound package code',
);

// 4. Best-rate selection remains backend-only and cheapest eligible.
assert(
  /getRates\s*\(\s*rateInput\s*,\s*\{\s*forceRefresh:\s*true,\s*applyMarkups:\s*false\s*\}\s*\)/.test(service) &&
    /isBlockedRate/.test(service) &&
    /bestRate/.test(service),
  'backend return-label service rate-shops and selects cheapest eligible bestRate',
);

// 5. Persisted/displayed return reference.
assert(
  /returnReference/.test(schema) && /return_reference/.test(migrations),
  'returns schema/migration persist returnReference / return_reference',
);
assert(
  /buildReturnReference/.test(route) &&
    /returnReference:\s*returnReference/.test(route) &&
    /returns\.returnReference/.test(route),
  'returns route generates, persists, and searches the order-number return reference',
);
assert(
  /returnReference:\s*row\.ret\.returnReference/.test(route),
  'client-safe return DTO includes persisted returnReference',
);
assert(
  /returnReference:\s*string \| null/.test(api),
  'PortalReturnRow exposes returnReference as a client-visible field',
);
assert(
  /returnReference/.test(returnsPage) && /Return ref/.test(returnsPage),
  'Returns list/detail display the return reference',
);

// 6. Create modal no longer lets the client pick a return-to location.
const createCode = stripComments(createModal);
assert(
  !/useReturnLocations|returnToLocationId|<select/.test(createCode),
  'create-return modal does not expose a return-to location selector',
);
assert(
  /DR PREPPER LLC/.test(createModal) && /413 W Walnut St/.test(createModal),
  'create-return modal tells users the fixed DRP return destination',
);
assert(
  !/returnToLocationId\?:/.test(api),
  'NewReturnInput no longer accepts returnToLocationId from the client',
);

// 7. Client-safe redaction and customer-facing postage remain intact.
for (const forbidden of ['selectedRateJson', 'selectedRate', 'labelCost', 'providerAccountId', 'carrierCode', 'serviceCode']) {
  assert(!new RegExp(`\\b${forbidden}\\s*[?:]`).test(returnApi), `client API return types expose no ${forbidden} field`);
}
assert(
  /returnCustomerShippingRate/.test(api) &&
    /resolveReturnCustomerPrice/.test(route) &&
    /resolveReturnPostageRate/.test(service),
  'client-visible return postage is returnCustomerShippingRate from the billing return-postage policy',
);

// 8. PDF download + inspection media visibility.
assert(
  /Download return label/.test(returnsPage) && /pdfUrl/.test(returnsPage),
  'return detail exposes a manual PDF download button',
);
assert(
  /ins\.media\.map/.test(returnsPage) && /m\.url/.test(returnsPage),
  'client/admin return detail renders inspection photos/videos from signed URLs',
);
assert(
  /multiple/.test(receiving) && /capture="environment"/.test(receiving) && /accept="image\/\*,video\/\*"/.test(receiving),
  'inspection capture supports multiple mobile camera photo/video uploads',
);

assert(
  pkg.scripts?.['test:client-portal-returns-cp045'] ===
    'node scripts/client-portal-returns-cp045-guard.mjs',
  'package exposes test:client-portal-returns-cp045',
);

if (failed) process.exit(1);
console.log('\nCP-045 returns workflow guard passed.');

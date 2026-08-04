import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-045 - Return labels use PrepShip best rate, fixed DRP return address with a saved recipient name,
// exact outbound physical facts, safe package fallback, persisted return reference, and client-safe
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
const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const schema = read('src/db/schema/returns.ts');
const shipmentSchema = read('src/db/schema/shipments.ts');
const api = readActiveClientPortalApiSource();
const returnApi = stripComments(
  api.slice(
    api.indexOf('export interface PortalReturnRow'),
    api.indexOf('// CP-030', api.indexOf('export interface PortalReturnRow')),
  ),
);
const createModal = read('portal-client/src/components/returns/ReturnCreateModal.tsx');
const returnsPage = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/ReturnInspectionHistory.tsx'),
  read('portal-client/src/components/returns/ReturnAttachmentGallery.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const receiving = read('portal-client/src/components/returns/ReturnReceivingModal.tsx');
const inspectionEditor = read('portal-client/src/components/returns/ReturnInspectionEditor.tsx');
const receivingUi = `${receiving}\n${inspectionEditor}`;
const capabilities = read('src/lib/client-portal/capabilities.ts');
const accessContract = read('src/lib/client-portal/contracts/access.ts');
const authorityIntegration = read('scripts/integration/client-portal-returns-cp045.integration.ts');
const integrationWorkflow = read('.github/workflows/integration-tests.yml');
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

// 1. Fixed return-to address: every label ships to the Gardena warehouse while
// the saved return recipient/attention name remains editable before purchase.
assert(
  /DRP_RETURN_TO_ADDRESS/.test(service),
  'return-label service defines one fixed DRP return-to address owner',
);
for (const value of ['DR PREPPER LLC', '413 W Walnut St', 'Gardena', 'CA', '90248']) {
  assert(service.includes(value), `fixed DRP return-to address includes ${value}`);
}
assert(
  /returnRow\?\.returnRecipientName\?\.trim\(\)/.test(service) &&
    /\.\.\.DRP_RETURN_TO_ADDRESS/.test(service) &&
    /name:\s*returnRecipientName/.test(service),
  'createReturnLabel combines the fixed DRP address with the persisted recipient name',
);
// This check previously REQUIRED `company: returnRecipientName`, i.e. it pinned
// the defect: a saved client value replacing DR PREPPER LLC as the label's
// company. That contradicted this section's own heading -- "the saved return
// recipient/ATTENTION NAME remains editable" -- and it is why the regression
// shipped and survived review. A guard written to match what the code does
// cannot notice that the code is wrong.
//
// The attention line is editable. The company identity is not.
assert(
  !/company:\s*returnRecipientName/.test(service),
  'the fixed DR PREPPER LLC company identity is never overwritten by client-editable data',
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

// 3. Physical package facts copy exactly from the outbound shipment. Legacy
// shipments with no selected package use ShipStation's generic protocol code;
// canonical weight and dimensions still control rating and label creation.
assert(
  shipmentSchema.includes('selectedPackageId'),
  'shipments has selectedPackageId as the existing outbound package owner',
);
assert(
  /assertOutboundReturnPackage\(outbound\)/.test(service),
  'return-label service validates outbound weight/dims before rating or labeling',
);
assert(
  /Missing outbound shipment return-label facts/.test(service) &&
    !/if \(!outbound\.selectedPackageId\) missing\.push\('package'\)/.test(service),
  'missing weight/dims blocks, but missing legacy package selection does not',
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
  /packageCode:\s*'package'/.test(service) &&
    /selectedPackageId:\s*string \| null/.test(service),
  'live label purchase uses the generic ShipStation package protocol code',
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
  /returnReference:\s*resolveReturnReference\(row\.ret\.returnReference/.test(route),
  'client-safe return DTO resolves persisted or legacy returnReference',
);
assert(
  /returnReference:\s*string;/.test(api),
  'PortalReturnRow exposes non-null returnReference as a client-visible field',
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
  /Return label recipient/.test(createModal) &&
    /returnRecipientName/.test(createModal) &&
    /Save & create return label/.test(createModal) &&
    /413 W Walnut St/.test(createModal),
  'create-return modal saves an editable recipient while showing the fixed warehouse destination',
);
assert(
  !/returnToLocationId\?:/.test(api) && /returnRecipientName:\s*string;/.test(api),
  'NewReturnInput accepts the saved recipient name but no selectable return-to location',
);

assert(
  /returnRecipientName/.test(schema) && /return_recipient_name/.test(migrations),
  'returns schema and additive migration persist the return-label recipient name',
);
assert(
  /app\.patch\('\/returns\/:id\{\[0-9\]\+\}\/recipient-name'/.test(route) &&
    /returnScopePredicate/.test(route) &&
    /portal\.returns\.recipient_name\.update/.test(route) &&
    /returnShipmentId/.test(route),
  'recipient-name save endpoint is scoped, audited, and blocks edits after label purchase',
);
assert(
  /returnedSkus:\s*string\[\]/.test(api) &&
    /returnedQuantity:\s*number/.test(api) &&
    /recipientName:\s*string \| null/.test(api) &&
    /returnedSkus/.test(route) &&
    /returnedQuantity/.test(route) &&
    /recipientName/.test(route) &&
    /header:\s*'Recipient'/.test(returnsPage) &&
    /header:\s*'SKU'/.test(returnsPage) &&
    /header:\s*'Qty'/.test(returnsPage),
  'returns table reads canonical recipient, SKU, and quantity facts from the backend DTO',
);

// 7. Client-safe redaction and customer-facing postage remain intact.
for (const forbidden of ['selectedRateJson', 'selectedRate', 'labelCost', 'providerAccountId', 'carrierCode', 'serviceCode']) {
  assert(!new RegExp(`\\b${forbidden}\\s*[?:]`).test(returnApi), `client API return types expose no ${forbidden} field`);
}
assert(
  /returnCustomerShippingRate/.test(api) &&
    /row\.validatedReturnCustomerShippingRate/.test(route) &&
    /freezePrepShipCustomerShippingMoney/.test(service) &&
    /returnCustomerShippingRate:\s*returnCustomerShippingRate\.toFixed\(2\)/.test(service),
  'client-visible return postage reads the PrepShip-frozen snapshot',
);

// 8. PDF download + inspection media visibility.
assert(
  /Download return label/.test(returnsPage) && /pdfUrl/.test(returnsPage),
  'return detail exposes a manual PDF download button',
);
assert(
  /ReturnAttachmentGallery/.test(returnsPage) && /item\.url/.test(returnsPage),
  'client/admin return detail renders inspection photos/videos from signed URLs',
);
assert(
  /multiple/.test(receivingUi) &&
    /capture="environment"/.test(receivingUi) &&
    /accept="image\/\*,video\/\*"/.test(receivingUi),
  'inspection capture supports multiple mobile camera photo/video uploads',
);
assert(
  /canInspectReturns:\s*scope\.isGlobal\s*\|\|\s*scope\.permissions\.includes\('settings:write'\)/.test(capabilities) &&
    /canInspectReturns:\s*boolean/.test(accessContract) &&
    /attemptedAuthoritativeWrite/.test(route) &&
    /if\s*\(isOperator\)\s*\{[\s\S]*?\.update\(returns\)/.test(route),
  'backend capability and receiving route reserve inspection/lifecycle authority for operators',
);
assert(
  /mode=\{canInspectReturns\s*\?\s*'operator'\s*:\s*'client'\}/.test(returnsPage) &&
    /mode === 'client'/.test(inspectionEditor) &&
    /Submit evidence/.test(inspectionEditor),
  'client return drawer provides evidence-only UI while operators receive the inspection UI',
);
assert(
  /client cannot submit receipt, condition, or status/.test(authorityIntegration) &&
    /client evidence does not advance returns\.status/.test(authorityIntegration) &&
    /only operator workflow advances returns\.status/.test(authorityIntegration) &&
    /Run CP-045 return-inspection authority integration suite/.test(integrationWorkflow),
  'CI runs the CP-045 behavioral client/operator authority matrix',
);

assert(
  pkg.scripts?.['test:client-portal-returns-cp045'] ===
    'node scripts/client-portal-returns-cp045-guard.mjs',
  'package exposes test:client-portal-returns-cp045',
);
assert(
  pkg.scripts?.['test:client-portal-returns-cp045:integration'] ===
    'tsx scripts/integration/client-portal-returns-cp045.integration.ts',
  'package exposes test:client-portal-returns-cp045:integration',
);

if (failed) process.exit(1);
console.log('\nCP-045 returns workflow guard passed.');

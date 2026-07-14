// CP-038 — client-portal built-bundle redaction guard.
//
// Frontend route guards are NOT a secrecy boundary — a client can download any lazy
// chunk — so this asserts the COMPILED output, not source. After
// `npm --prefix portal-client run build`, it scans portal-client/dist/assets/*.js and
// FAILs if admin/internal house-cost vocabulary appears in a client-loadable chunk.
//
// BUILD-DEPENDENT: intentionally excluded from the static run-guards suite (see the
// DENY regex in scripts/run-guards.mjs). Runs after build:web in
// test:full-site-certification and in CI's build job.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.join(root, 'portal-client/dist/assets');

// Specific house/internal tokens only. Deliberately NOT bare `margin`/`profit`/
// `markup`: `margin` ships as a Recharts chart-prop key, and `markup` appears as a
// coincidental substring in vendor chunks (charts / write-excel-file). The
// DISTINCTIVE admin-markup tokens below are safe (verified absent from every
// vendor chunk) and are now forbidden EVERYWHERE — no chunk is allowlisted.
const FORBIDDEN = [
  'label_cost',
  'labelCost',
  'selectedRate',
  'selected_rate',
  'standard_shipping_cost',
  'avgStandardShippingCost', // CP-038 renamed this summary key to avgShippingCharge — backstop its regression
  'standardShipCount',
  'standardShippingTotal',
  'is_external_shipped',
  'carrier_code',
  'service_code',
  'shipAlloc',
  'shipUnits',
  // CP-038b: admin Carrier-Markups vocabulary must never ship in the customer bundle.
  'profit layer',
  'MarkupsEditor',
  'MarkupValue',
  'MarkupGroup',
  'client-portal/markups',
  // CP-038: the client-facing DTO fields were renamed to charge/billed intent names
  // (avgCostPerOrder→avgChargePerOrder, costSummary→chargeSummary, total_shipping→
  // billedShippingTotal). Backstop the old cost/allocation-named keys so a rename
  // regression can't reintroduce cost vocabulary into the customer bundle.
  'avgCostPerOrder',
  'costSummary',
  'total_shipping',
  // CP-047: internal Analysis SKU diagnostics/cost fields are backend-only.
  'ext_shipped',
  'std_ship_count',
  'std_total',
  'exp_ship_count',
  'exp_total',
  'ship_count_with_cost',
  'total_selling_fee',
  // CP-054: raw Connections identifiers/errors and Shopify's canonical domain
  // are backend-only. Customer chunks use displayAccountIdentifier plus safe
  // status/reason enums.
  'accountIdentifier',
  'lastSyncError',
  'myshopifyDomain',
];

// CP-038b DONE: the Markups admin UI (MarkupsEditor + markups API client + Markup*
// types) was removed from the Client Portal, so NO chunk is allowlisted — every
// built chunk must be free of the forbidden admin/internal vocabulary above.
const ALLOWLIST_PREFIXES = [];
const isAllowlisted = (file) => ALLOWLIST_PREFIXES.some((p) => file.startsWith(p));

if (!fs.existsSync(assetsDir)) {
  console.error(
    `FAIL bundle-redaction: ${assetsDir} not found — run \`npm --prefix portal-client run build\` first.`,
  );
  process.exit(1);
}
const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error('FAIL bundle-redaction: no JS assets in the build output.');
  process.exit(1);
}

let failed = false;
for (const file of jsFiles) {
  if (isAllowlisted(file)) {
    console.log(`skip  ${file} (allowlisted admin chunk)`);
    continue;
  }
  const text = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  for (const term of FORBIDDEN) {
    if (text.includes(term)) {
      console.error(`FAIL  ${file} contains forbidden term "${term}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nbundle-redaction guard FAILED — admin/internal vocabulary in a client chunk.');
  process.exit(1);
}
console.log(`\nbundle-redaction guard passed (${jsFiles.length} chunks scanned).`);

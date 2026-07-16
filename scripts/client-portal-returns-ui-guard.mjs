import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
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

// Strip // line comments and /* */ block comments so the "forbidden identifier"
// checks test executable CODE, not the header prose that legitimately documents
// what the redaction contract forbids (e.g. "never expose carrierCode"). A crude
// strip is fine here — we only need to remove comment bodies, and no string
// literal in these files contains a `//` or block-comment sequence.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const aggregator = read('src/routes/client-portal.ts');
const api = readActiveClientPortalApiSource();
const hooks = read('portal-client/src/lib/hooks.ts');
const nav = read('portal-client/src/nav.ts');
const appRouter = read('portal-client/src/App.tsx');
const page = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const createModal = read('portal-client/src/components/returns/ReturnCreateModal.tsx');
const createModalCode = stripComments(createModal);
const pkg = JSON.parse(read('package.json'));

// ── 1. Route sub-module exists + mounted in the aggregator ──
assert(route.length > 0, 'src/routes/client-portal/returns.ts exists');
assert(
  /import\s+returnsRoute\s+from\s+'\.\/client-portal\/returns'/.test(aggregator),
  'the aggregator imports the returns sub-router',
);
assert(
  /app\.route\('\/',\s*returnsRoute\)/.test(aggregator),
  'the aggregator mounts returnsRoute at /',
);

// ── 2. Every endpoint is scope-gated like the sibling routers ──
// The exact guard line the sibling routers use (shipments.ts, invoices.ts):
//   const scope = scopeOrResponse(c);
//   if (!isClientPortalScope(scope)) return scope;
assert(
  /scopeOrResponse\(c\)/.test(route) && /isClientPortalScope/.test(route),
  'the returns route uses scopeOrResponse + isClientPortalScope (same scope guard as the sibling routers)',
);
// Count the endpoints and require each to carry the scope guard.
const scopeGuardCount = (route.match(/if\s*\(!isClientPortalScope\(scope\)\)\s*return\s+scope;/g) || []).length;
const endpointCount = (route.match(/app\.(get|post)\(/g) || []).length;
assert(endpointCount >= 5, 'the returns route declares the expected endpoints (list, detail, create, label, deliver)');
assert(
  scopeGuardCount >= endpointCount,
  `every returns endpoint carries the scope guard (${scopeGuardCount} guards for ${endpointCount} endpoints)`,
);
// Scope-ownership on create + audit on each surface.
assert(
  /orderScopePredicate/.test(route),
  'the returns route bounds visibility/creation with the canonical orderScopePredicate (scope ownership)',
);
assert(
  /recordPortalAudit\(/.test(route),
  'the returns route audits its surfaces (recordPortalAudit)',
);

// ── 3. List/detail DTOs are carrier/service/provider-free ──
// Slice the client-safe DTO builder + its type; neither may reference a
// forbidden identifier.
function sliceBlock(src, startRe) {
  const m = src.match(startRe);
  if (!m) return '';
  const start = m.index ?? 0;
  const rest = src.slice(start);
  const endRel = rest.search(/\n\}/);
  return endRel === -1 ? rest.slice(0, 2000) : rest.slice(0, endRel + 2);
}
const forbidden = [
  'carrierCode',
  'serviceCode',
  'carrierProvider',
  'providerAccountId',
  'providerAccount',
  'carrierAccountId',
  'selectedRateJson',
  'selectedRate',
];
const dtoBuilder = sliceBlock(route, /function toClientSafeReturnRow\s*\(/);
assert(dtoBuilder.length > 0, 'the returns route builds a client-safe DTO (toClientSafeReturnRow)');
for (const id of forbidden) {
  assert(!new RegExp(id).test(dtoBuilder), `the client-safe return row DTO never sets ${id}`);
}
assert(
  /returnCustomerShippingRate/.test(dtoBuilder) && !/\bprice\s*:/.test(dtoBuilder),
  'the client-safe return row DTO uses returnCustomerShippingRate, not generic price',
);
assert(
  !/\breturnCost\b/.test(stripComments(route)),
  'the returns route never names returnCost on its client-facing/API contract',
);
// The whole route file must not project a carrier/service onto a client DTO. It
// legitimately never selects carrierCode/serviceCode from shipments; assert the
// forbidden identifiers are entirely absent from the route module's CODE (the
// header comment documenting the contract is stripped first).
const routeCode = stripComments(route);
for (const id of ['carrierCode', 'serviceCode', 'selectedRateJson', 'providerAccountId']) {
  assert(
    !new RegExp(id).test(routeCode),
    `the returns route never references ${id} anywhere (carrier/service/provider stays server-internal)`,
  );
}
// The frontend return DTO type must likewise be carrier/service/provider-free.
const apiReturnType = sliceBlock(api, /export interface PortalReturnRow\s*\{/);
assert(apiReturnType.length > 0, 'the frontend declares a PortalReturnRow type');
for (const id of forbidden) {
  assert(!new RegExp(id).test(apiReturnType), `PortalReturnRow never exposes ${id}`);
}
assert(
  /returnCustomerShippingRate/.test(apiReturnType) && !/\bprice\s*:/.test(apiReturnType),
  'PortalReturnRow uses returnCustomerShippingRate, not generic price',
);
const apiReturnLabelResult = sliceBlock(api, /export interface ReturnLabelResult\s*\{/);
assert(
  /returnCustomerShippingRate/.test(apiReturnLabelResult) && !/\bprice\s*:/.test(apiReturnLabelResult),
  'ReturnLabelResult uses returnCustomerShippingRate, not generic price',
);

// ── 4. Create/label/deliver delegate to the backend services ──
assert(
  /createReturnLabel\(/.test(route),
  'the label endpoint delegates to createReturnLabel (CP-027 service) — the route never rate-shops',
);
assert(
  /deliverReturn\(/.test(route),
  'the deliver endpoint delegates to deliverReturn (CP-028 service)',
);
// The route must NOT compute rates / pick a carrier itself.
assert(
  !/getRates|isBlockedRate|carrierConnectors/.test(route),
  'the returns route never rate-shops or calls a carrier connector (no getRates/isBlockedRate/carrierConnectors)',
);
// The PDF is served through the existing label route (labelUrl) — no new
// mechanism is invented in this route.
assert(
  /labelUrl/.test(route) && /pdfUrl/.test(route),
  'the return label PDF is surfaced via the existing shipments.labelUrl (served by the /labels route), exposed as pdfUrl',
);

// ── 5. Frontend page exists + registered in the router + in the nav ──
assert(page.length > 0, 'portal-client/src/pages/Returns.tsx exists');
assert(
  /import\('\.\/pages\/Returns'\)/.test(appRouter) && /path="\/returns"/.test(appRouter),
  'the Returns page is lazy-imported and registered at /returns in the router',
);
assert(
  /to:\s*'\/returns'/.test(nav) && /label:\s*'Returns'/.test(nav),
  'a Returns entry is present in the nav',
);

// ── 6. Frontend renders backend fields; no rate/carrier computation ──
// The page + create modal must NOT reference any rate/carrier computation.
for (const surface of [
  ['Returns page', stripComments(page)],
  ['ReturnCreateModal', stripComments(createModal)],
]) {
  const [name, src] = surface;
  for (const id of ['getRates', 'isBlockedRate', 'carrierCode', 'serviceCode', 'bestRate', 'cheapest']) {
    assert(!new RegExp(id).test(src), `${name} does not compute rates/carrier (no ${id})`);
  }
}
// The page renders backend fields (status / delivery / tracking) rather than
// deriving them.
assert(
  /\.status/.test(page) && /deliveryMethod/.test(page) && /trackingNumber/.test(page),
  'the Returns page renders backend-owned fields (status / deliveryMethod / trackingNumber)',
);
// A PDF download entry point exists (manual_pdf delivery / Shopify-failed).
assert(
  /pdfUrl/.test(page) && /Download/.test(page),
  'the Returns page exposes a return-label PDF download (pdfUrl)',
);
assert(
  /Return postage/.test(page) &&
    /returnCustomerShippingRate/.test(page) &&
    !/\b[rd]\.price\b/.test(page) &&
    !/key:\s*'price'/.test(page),
  'the Returns page renders returnCustomerShippingRate as Return postage, not generic Price',
);

// ── 7. The create flow POSTs to the backend ──
assert(
  /createReturn:\s*\(token: string, body: NewReturnInput\)\s*=>\s*\n?\s*apiPost/.test(api) ||
    (/createReturn:/.test(api) && /apiPost<\{[^}]*\}>\(token, '\/api\/client-portal\/returns'/.test(api)),
  'portalApi.createReturn POSTs to /api/client-portal/returns',
);
assert(
  /portalApi\.createReturn\(/.test(createModal),
  'the create-return modal submits via portalApi.createReturn (posts to the backend)',
);
// Partial quantities are collected + sent (validated server-side, not priced).
assert(
  /quantity/.test(createModal) && /items/.test(createModal),
  'the create-return modal collects per-item return quantities and sends them as items',
);
// CP-045 acceptance: the create-return modal shows the fixed warehouse destination,
// saves its editable recipient name, and does not expose a return-to location selector.
assert(
  !/returnToLocationId|useReturnLocations|<select/.test(createModalCode),
  'the create-return modal does not expose or submit a return-to location selector',
);
assert(
  /Return label recipient/.test(createModal) &&
    /returnRecipientName/.test(createModal) &&
    /Save & create return label/.test(createModal) &&
    /413 W Walnut St/.test(createModal) &&
    /Gardena, CA 90248/.test(createModal),
  'the create-return modal saves an editable recipient at the fixed warehouse destination',
);
assert(
  !/returnToLocationId\?:/.test(api) && /returnRecipientName:\s*string;/.test(api),
  'NewReturnInput accepts the saved recipient name but no return-to location selection',
);
assert(
  /returnReference:\s*string;/.test(api) &&
    /resolveReturnReference/.test(route) &&
    /Return ref/.test(page),
  'returns UI exposes the canonical non-null returnReference for display/search',
);

// ── CP-032: the create-return modal creates the LABEL immediately (PDF-only) ──
assert(
  /portalApi\.createReturnLabel\(/.test(createModal),
  'the create-return modal creates the label immediately after the return (portalApi.createReturnLabel), not just a request',
);
// CP-032: a supplied orderItemId is validated against the order + its SKU.
assert(
  /does not belong to this order/.test(route),
  'the create endpoint validates a supplied orderItemId belongs to the order + matches the SKU',
);
// CP-032: list/detail reads the frozen billing-policy snapshot and never
// recalculates from raw house/label cost.
assert(
  /row\.ret\.returnCustomerShippingRate/.test(route) &&
    !/internalReturnLabelCost|resolveReturnCustomerPrice/.test(route),
  'the returns DTO reads the frozen returnCustomerShippingRate snapshot (never raw label/house cost)',
);
// The label/deliver client methods post to the backend too. Match each method's
// definition through its apiPost call (non-greedy, across the arrow body).
assert(
  /createReturnLabel:\s*\([^)]*\)\s*=>\s*[\s\S]{0,120}?apiPost/.test(api),
  'portalApi exposes a createReturnLabel POST method',
);
assert(
  /deliverReturn:\s*\([^)]*\)\s*=>\s*[\s\S]{0,120}?apiPost/.test(api),
  'portalApi exposes a deliverReturn POST method',
);
// The returns hooks exist (list + detail).
assert(
  /useReturns/.test(hooks) && /useReturnDetail/.test(hooks),
  'the frontend exposes useReturns + useReturnDetail react-query hooks',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-returns-ui'] ===
    'node scripts/client-portal-returns-ui-guard.mjs',
  'package.json exposes test:client-portal-returns-ui',
);

if (failed) process.exit(1);
console.log('\nCP-029 client-portal Returns UI guard passed.');

import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// CP-036 — Client-portal returns canonical-field + billing-description redaction
// guard.
//
// CP-036 requires that client-facing return surfaces expose ONLY canonical,
// intent-named fields (returnCustomerShippingRate) and never leak internal
// cost / rate / markup variable NAMES or VALUES — not on the frontend DTO types,
// not on the /api/client-portal/returns route response, and not (via invoices /
// exports) through the frozen billing_line_items.description string.
//
// The price -> returnCustomerShippingRate rename and the carrier / service /
// provider / selectedRate redaction are already pinned by
// client-portal-returns-ui-guard.mjs (CP-029) and
// client-portal-returns-label-guard.mjs (CP-027). THIS guard closes the specific
// CP-036 gaps those two do NOT cover:
//
//   1. The three client-facing return TYPES (PortalReturnRow /
//      PortalReturnDetail / ReturnLabelResult) declare no field named
//      price / cost / labelCost / returnCost / markup / override /
//      selectedRate(Json) / provider(Account) / carrierCode / serviceCode — and
//      the row + label-result carry the canonical returnCustomerShippingRate.
//   2. The returns ROUTE client-safe DTO builder returns no bare
//      price / cost / labelCost / returnCost key and reads the persisted,
//      intent-named returnCustomerShippingRate snapshot directly.
//   3. billing_line_items.description NEVER reaches a client-facing surface: no
//      src/lib/client-portal read-model and no src/routes/client-portal route
//      selects a billing-line description column. Client invoices aggregate by
//      lineType into backend-owned totals only, so internal billing wording in a
//      description provably cannot leak into a client invoice / export. (That
//      wording is itself now removed from the generator's outbound shipping line
//      and kept out of every description by billing-description-policy-free-guard.mjs.)
//
// STATIC ONLY — no db / live / generation.
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

// Slice an `export interface NAME ... { ... }` block up to its column-0 closing
// brace so field-name checks stay scoped to that one declaration.
function sliceInterface(src, name) {
  const m = src.match(new RegExp(`export interface ${name}\\b[^{]*\\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
}

// Slice a `function NAME(` block up to its column-0 closing brace.
function sliceFn(src, startRe) {
  const m = src.match(startRe);
  if (!m) return '';
  const start = m.index ?? 0;
  const rest = src.slice(start);
  const endRel = rest.search(/\n\}/);
  return endRel === -1 ? rest.slice(0, 2000) : rest.slice(0, endRel + 2);
}

// Recursively collect source files under a repo-relative directory.
function walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, ent.name);
    if (ent.isDirectory()) out.push(...walk(child));
    else if (ent.isFile() && /\.(ts|tsx|mjs|js)$/.test(ent.name)) out.push(child);
  }
  return out;
}

// Internal-only field NAMES that must never appear as a member on a client-facing
// return TYPE. Matched as a TS member declaration (`name:` / `name?:`), so a
// backend var like `internalReturnLabelCost` is unaffected (its "LabelCost" is
// camel-cased with a capital L; the lowercase field tokens below can't match it).
const FORBIDDEN_FIELDS = [
  'price',
  'cost',
  'labelCost',
  'returnCost',
  'selectedRate',
  'selectedRateJson',
  'markup',
  'override',
  'carrierCode',
  'serviceCode',
  'providerAccount',
  'providerAccountId',
];

// ── 1. Client-facing return TYPES are canonical + leak-free ─────────────────
const api = readActiveClientPortalApiSource();
assert(api.length > 0, 'active Client Portal API contract source exists');

for (const iface of ['PortalReturnRow', 'PortalReturnDetail', 'ReturnLabelResult']) {
  const block = sliceInterface(api, iface);
  assert(block.length > 0, `api.ts declares the ${iface} interface`);
  for (const field of FORBIDDEN_FIELDS) {
    assert(
      !new RegExp(`\\b${field}\\s*[?:]`).test(block),
      `${iface} declares no internal ${field} field (canonical fields only)`,
    );
  }
}
// PortalReturnDetail inherits returnCustomerShippingRate via `extends
// PortalReturnRow`, so only the base row + the label result declare it inline.
for (const iface of ['PortalReturnRow', 'ReturnLabelResult']) {
  const block = sliceInterface(api, iface);
  assert(
    /returnCustomerShippingRate\s*[?:]/.test(block),
    `${iface} declares the canonical returnCustomerShippingRate field`,
  );
}
assert(
  /interface PortalReturnDetail extends PortalReturnRow/.test(api),
  'PortalReturnDetail extends PortalReturnRow (inherits returnCustomerShippingRate — no re-declared price/cost)',
);

// ── 2. Route client-safe DTO builder returns canonical fields only ──────────
const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
assert(route.length > 0, 'src/routes/client-portal/returns.ts exists');

const builder = sliceFn(route, /function toClientSafeReturnRow\s*\(/);
assert(builder.length > 0, 'the returns route builds a client-safe DTO (toClientSafeReturnRow)');
assert(
  /returnCustomerShippingRate\s*:/.test(builder),
  'the client-safe return DTO returns the canonical returnCustomerShippingRate key',
);
// The read DTO consumes the frozen intent-named snapshot and never reads raw
// shipment label/house cost or reruns pricing policy.
assert(
  /row\.validatedReturnCustomerShippingRate/.test(builder) &&
    !/internalReturnLabelCost|resolveReturnCustomerPrice/.test(builder),
  'the DTO reads the tuple-validated customer return rate without raw-cost repricing',
);
for (const key of ['price', 'cost', 'labelCost', 'returnCost']) {
  assert(
    !new RegExp(`\\b${key}\\s*:`).test(builder),
    `the client-safe return DTO returns no bare ${key} key`,
  );
}

// ── 3. billing_line_items.description never reaches a client-facing surface ──
// Concatenate every client-portal read-model + route source file and assert none
// of them project a billing-line description column onto a client response.
const clientPortalFiles = [...walk('src/lib/client-portal'), ...walk('src/routes/client-portal')];
assert(clientPortalFiles.length > 0, 'client-portal read-model + route sources are present');
const clientPortalSrc = clientPortalFiles.map((rel) => read(rel)).join('\n');
for (const pat of [
  /billingLineItems\.description/,
  /billing_line_items\.description/,
  /\bb\.description\b/,
  /\bli\.description\b/,
  /lineItems\.description/,
]) {
  assert(
    !pat.test(clientPortalSrc),
    `no client-portal read-model/route selects a billing-line description (${pat.source}) — invoices aggregate by lineType into totals only`,
  );
}

// ── package.json wiring (also auto-discovered by scripts/run-guards.mjs) ─────
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-returns-canonical-fields'] ===
    'node scripts/client-portal-returns-canonical-fields-guard.mjs',
  'package.json exposes test:client-portal-returns-canonical-fields',
);

if (failed) process.exit(1);
console.log('\nCP-036 client-portal returns canonical-fields guard passed.');

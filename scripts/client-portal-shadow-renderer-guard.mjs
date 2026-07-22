// CP-025 — Client Portal shadow-renderer / source-of-truth LAW guard.
//
// This is the umbrella guard for CP-017→024 + CP-021 + the CP-026→031 returns
// work. It does NOT re-remediate any surface and does NOT duplicate the
// behavioral guards (sales-sot-drift / analytics-parity / architecture). It
// installs and pins the LAW + the matrix + the enforcement layer, so a future
// edit cannot quietly delete the law, break the AGENTS/CLAUDE/.cursorrules
// mirror, gut the SOT matrix, or unwire the guards that enforce it.
//
// Pins:
//   (a) The shadow-renderer SOT law section is present in AGENTS.md AND
//       CLAUDE.md AND .cursorrules, and the three files are byte-identical
//       (catches a future edit that breaks the mirror).
//   (b) docs/source-of-truth-matrix.md exists and names the key Client Portal
//       surfaces + the intent-named DTO fields.
//   (c) A light complement to the existing behavioral guards: the sibling
//       enforcement guards still exist AND are wired into package.json (so the
//       law's enforcement layer can't be silently deleted).
//
// Robustness (learned from the sibling guards): CRLF-tolerant, and code is
// stripped of comments before scanning so prose in a comment can never satisfy
// (or trip) a source assertion.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readRaw = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

// Normalize line endings so byte-comparison + phrase scans tolerate CRLF vs LF.
const lf = (s) => s.replace(/\r\n/g, '\n');
// Collapse whitespace so phrase assertions tolerate reflow / wrapping.
const flat = (s) => lf(s).replace(/\s+/g, ' ');
// Strip // line comments and /* */ block comments before scanning code, so a
// prose mention inside a comment can never satisfy a source pin.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── (a) The SOT law lives in AGENTS.md and both mirrors, byte-identical ──
const AGENTS = 'AGENTS.md';
const MIRRORS = ['CLAUDE.md', '.cursorrules'];

assert(exists(AGENTS), 'AGENTS.md exists');
for (const m of MIRRORS) assert(exists(m), `${m} exists`);

const agentsRaw = readRaw(AGENTS);
// The section heading + the load-bearing phrases of the law. We check the
// heading and a representative set of the rule's clauses so a gutted section
// (heading kept, body deleted) still fails.
const LAW_HEADING = /##\s+Client Portal\s+[—-]\s+shadow-renderer\s*\/\s*source-of-truth law/i;
const agentsFlat = flat(agentsRaw);
const LAW_PHRASES = [
  'shadow renderer',
  'canonical', // canonical owner
  'intent-named DTO fields',
  'independent source of truth',
  'event clock',
  'customerShippingRate',
  'inventoryQuantity',
];

function hasLaw(rel) {
  const raw = readRaw(rel);
  if (!LAW_HEADING.test(lf(raw))) return false;
  const f = flat(raw);
  return LAW_PHRASES.every((p) => f.toLowerCase().includes(p.toLowerCase()));
}

assert(LAW_HEADING.test(lf(agentsRaw)), 'AGENTS.md has the shadow-renderer / SOT law section heading');
assert(hasLaw(AGENTS), 'AGENTS.md law section names the load-bearing clauses (shadow renderer, canonical owner, intent-named DTOs, event clock, no independent SOT)');
for (const m of MIRRORS) {
  assert(hasLaw(m), `${m} also carries the full shadow-renderer / SOT law section`);
}

// Byte-identical mirror (the whole point of the cp AGENTS.md CLAUDE.md ritual).
// Compare on normalized line endings so a pure CRLF/LF difference is not a false
// FAIL, but any real content drift between the three files trips.
const agentsLf = lf(agentsRaw);
for (const m of MIRRORS) {
  assert(lf(readRaw(m)) === agentsLf, `${m} is byte-identical to AGENTS.md (the mirror is intact)`);
}

// ── (b) The SOT matrix exists and names the surfaces + intent-named fields ──
const MATRIX = 'docs/source-of-truth-matrix.md';
assert(exists(MATRIX), 'docs/source-of-truth-matrix.md exists');
const matrix = flat(readRaw(MATRIX));

// Every major Client Portal surface the umbrella ticket enumerates must appear
// as a matrix heading/section.
const SURFACES = [
  'Dashboard',
  'Orders',
  'Order Detail',
  'Shipments',
  'Inventory',
  'Analysis',
  'Billing',
  'Invoices',
  'Returns',
  'Inbound',
  'Connections',
  'Rate Sheet',
];
for (const s of SURFACES) {
  assert(matrix.includes(s), `SOT matrix covers the ${s} surface`);
}

// The matrix must reference the intent-named DTO fields (real identifiers that
// exist in src/lib/client-portal/dto.ts), the classification vocabulary, and the
// shadow-renderer framing — so it stays a real mapping, not an empty stub.
const MATRIX_FIELDS = [
  'customerShippingRate',
  'inventoryQuantity',
  'warehouseShipped30d',
  'chargeSummary',
  'trackingNumber',
  'displayTrackingNumber',
];
for (const fld of MATRIX_FIELDS) {
  assert(matrix.includes(fld), `SOT matrix names the intent-named DTO field ${fld}`);
}
assert(matrix.includes('shadow renderer'), 'SOT matrix states the shadow-renderer framing');
assert(
  matrix.includes('presentation-only') &&
    matrix.includes('derived-from-canonical') &&
    matrix.includes('backend-owned-truth'),
  'SOT matrix uses the three classifications (presentation-only / derived-from-canonical / backend-owned-truth)',
);
assert(
  /DJ-approved exceptions/i.test(matrix),
  'SOT matrix carries a DJ-approved exceptions section',
);

// ── (c) The enforcement layer (sibling guards) still exists AND is wired ──
// This guard deliberately does NOT re-implement those behavioral checks; it just
// asserts they are present and gated, so the law's teeth can't be pulled.
const pkg = JSON.parse(readRaw('package.json'));
const scripts = pkg.scripts ?? {};

const ENFORCEMENT = [
  {
    file: 'scripts/client-portal-sales-sot-drift-guard.mjs',
    script: 'test:client-portal-sales-sot-drift',
    cmd: 'node scripts/client-portal-sales-sot-drift-guard.mjs',
  },
  {
    file: 'scripts/client-portal-analytics-parity-guard.mjs',
    script: 'test:client-portal-analytics-parity',
    cmd: 'node scripts/client-portal-analytics-parity-guard.mjs',
  },
  {
    file: 'scripts/client-portal-architecture-guard.mjs',
    script: 'guard:client-portal-architecture',
    cmd: 'node scripts/client-portal-architecture-guard.mjs',
  },
];
for (const g of ENFORCEMENT) {
  assert(exists(g.file), `enforcement guard present: ${g.file}`);
  assert(scripts[g.script] === g.cmd, `enforcement guard wired: package exposes ${g.script}`);
}

// The DTO mapper is the backend owner the matrix + law delegate to; confirm the
// intent-named fields actually live there (strip comments so the doc-comments
// naming these fields don't satisfy the pin — we want the real code).
const dtoCode = stripComments(readRaw('src/lib/client-portal/dto.ts'));
for (const fld of ['customerShippingRate', 'inventoryQuantity', 'warehouseShipped30d', 'chargeSummary']) {
  assert(dtoCode.includes(fld), `dto.ts (code, comments stripped) still owns the intent-named field ${fld}`);
}

const INVENTORY_SHADOW_FILES = [
  'src/lib/client-portal/contracts/inventory.ts',
  'src/lib/client-portal/dto.ts',
  'src/lib/client-portal/read-models/inventory.ts',
  'portal-client/src/pages/Inventory.tsx',
];
for (const rel of INVENTORY_SHADOW_FILES) {
  const code = stripComments(readRaw(rel));
  for (const forbidden of ['currentStock', 'effectiveStock', 'stockQty', 'displayStock', 'totalUnits']) {
    assert(!code.includes(forbidden), `${rel} does not expose competing inventory quantity ${forbidden}`);
  }
}

// ── This guard is itself wired into the suite ──
assert(
  scripts['test:client-portal-shadow-renderer'] ===
    'node scripts/client-portal-shadow-renderer-guard.mjs',
  'package exposes test:client-portal-shadow-renderer',
);

if (failed) process.exit(1);
console.log('\nCP-025 client portal shadow-renderer / SOT law guard passed.');

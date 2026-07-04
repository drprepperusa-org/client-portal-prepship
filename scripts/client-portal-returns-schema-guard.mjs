// CP-026 — Returns data model guard.
//
// The return LABEL / tracking / cost SOT stays on `shipments` (isReturn +
// returnForShipmentId + returnReason + labelUrl/labelTracking/labelCost). The
// new returns / return_items / return_inspections / return_inspection_media
// tables own only workflow + item + inspection + media detail and must NEVER
// re-declare label money or tracking. This guard pins that boundary plus the
// partial-return, one-active-per-order, audited-override, and inspection/media
// invariants, and that the additive migration was generated.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');

let failed = false;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS ${msg}`);
  } else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}

const schema = read('src/db/schema/returns.ts');
const shipments = read('src/db/schema/shipments.ts');
const index = read('src/db/schema/index.ts');
const drizzleConfig = read('drizzle.config.ts');
const pkg = JSON.parse(read('package.json'));

// All committed drizzle migrations concatenated — robust to re-numbering.
const drizzleDir = path.join(root, 'drizzle');
const migrationSql = fs.existsSync(drizzleDir)
  ? fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(drizzleDir, f), 'utf8'))
      .join('\n')
  : '';

// ── Canonical return-label SOT stays on shipments ──
assert(
  shipments.includes('isReturn') && shipments.includes('returnForShipmentId') && shipments.includes('returnReason'),
  'shipments keeps the canonical return-label SOT (isReturn / returnForShipmentId / returnReason)',
);
assert(
  // Match column DECLARATIONS (identifier + colon), not the prose in this file's
  // own SOT-boundary comment that names those shipments columns.
  !/\b(labelUrl|labelTracking|labelCost|selectedRateJson)\s*:/.test(schema),
  'the new return tables never re-declare label/tracking/cost/rate columns — that truth stays on shipments',
);

// ── The four canonical tables exist ──
assert(schema.includes("'returns'"), 'returns workflow table defined');
assert(schema.includes("'return_items'"), 'return_items table defined');
assert(schema.includes("'return_inspections'"), 'return_inspections table defined');
assert(schema.includes("'return_inspection_media'"), 'return_inspection_media table defined');

// ── Partial returns + canonical item linkage ──
assert(
  schema.includes('quantity: numeric') && schema.includes('orderItemId') && schema.includes('references(() => orderItems.id'),
  'return_items supports partial quantities and links to canonical order_items',
);

// ── One active return per order + audited admin override ──
assert(
  schema.includes('returns_one_active_per_order_idx') &&
    schema.includes("not in ('cancelled', 'closed')") &&
    schema.includes('adminOverride'),
  'a partial unique index enforces one active return per order unless adminOverride',
);
assert(
  schema.includes('adminOverrideBy') && schema.includes('adminOverrideReason'),
  'admin override is separately auditable (who + why)',
);

// ── Inspection + media ──
assert(
  schema.includes('inspectorEmail') && schema.includes('receivedAt') && schema.includes('condition'),
  'return_inspections captures inspector identity, received date, and condition',
);
assert(
  schema.includes('mediaType') && schema.includes('storageRef'),
  'return_inspection_media stores media metadata + a storage reference (never the binary)',
);

// ── Return-to location uses canonical locations ──
assert(
  schema.includes('returnToLocationId') && schema.includes('references(() => locations.id'),
  'return-to location references canonical locations',
);

// ── Wired into schema barrel + drizzle config + additive migration generated ──
assert(index.includes("export * from './returns'"), 'schema index re-exports returns');
assert(drizzleConfig.includes("'./src/db/schema/returns.ts'"), 'drizzle.config includes returns.ts');
assert(
  migrationSql.includes('CREATE TABLE "returns"') &&
    migrationSql.includes('CREATE TABLE "return_items"') &&
    migrationSql.includes('CREATE TABLE "return_inspections"') &&
    migrationSql.includes('CREATE TABLE "return_inspection_media"') &&
    migrationSql.includes('returns_one_active_per_order_idx'),
  'an additive migration creates all four tables + the one-active-per-order index',
);

assert(
  pkg.scripts?.['test:client-portal-returns-schema'] === 'node scripts/client-portal-returns-schema-guard.mjs',
  'package exposes test:client-portal-returns-schema',
);

if (failed) process.exit(1);
console.log('\nCP-026 returns schema guard passed.');

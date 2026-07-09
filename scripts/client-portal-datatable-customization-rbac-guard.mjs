// CP-035 — DataTable column customization is an ADMIN privilege, OFF for clients.
//
// DJ: client users must not toggle/reorder/resize columns ("Columns x/x" is an
// admin privilege). This guard pins that the shared DataTable gates ALL column
// customization (the Columns chooser, Reset, drag-to-reorder, resize, AND the
// persisted localStorage layout) behind an explicit `allowColumnCustomization`
// prop that DEFAULTS OFF, and that NO Client Portal page opts in — so every
// customer table is fixed and a hidden/removed column can never be resurrected
// from a stale localStorage layout.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS ${msg}`);
  } else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}

const dt = read('portal-client/src/components/ui/DataTable.tsx');

// ── 1. The gate prop exists and defaults OFF ──
assert(/allowColumnCustomization\?:\s*boolean/.test(dt), 'DataTable declares an allowColumnCustomization?: boolean prop');
assert(/allowColumnCustomization\s*=\s*false/.test(dt), 'allowColumnCustomization DEFAULTS to false (customer-safe)');

// ── 2. Customization requires an EXPLICIT opt-in — never inferred from tableId ──
assert(
  /const customizable\s*=\s*Boolean\(tableId\)\s*&&\s*allowColumnCustomization/.test(dt),
  'customization requires tableId AND an explicit allowColumnCustomization opt-in (not tableId alone)',
);

// ── 3. Controls, drag, resize, and persisted layout are ALL gated on `customizable` ──
assert(/\{customizable && \(/.test(dt), 'the Columns x/x chooser + Reset controls render only when customizable');
assert(/const canDrag\s*=\s*customizable\s*&&/.test(dt), 'header drag-to-reorder is gated on customizable');
assert(/const canResize\s*=\s*customizable\s*&&/.test(dt), 'column resize is gated on customizable');
assert(
  /useColumnLayout\(customizable \? tableId : undefined/.test(dt),
  'when NOT customizable, tableId is not passed to useColumnLayout — stale localStorage layout is ignored (no column resurrection)',
);
// Guard against a regression to the old always-on gate.
assert(!/\{tableId && \(/.test(dt), 'the customization controls are no longer gated on tableId alone (regression check)');

// ── 4. No Client Portal page enables customization for client users ──
const pagesDir = 'portal-client/src/pages';
const pageFiles = fs
  .readdirSync(path.join(root, pagesDir))
  .filter((f) => f.endsWith('.tsx'));
for (const f of pageFiles) {
  const src = read(`${pagesDir}/${f}`);
  if (f === 'Orders.tsx') {
    assert(
      /useMe\(\)/.test(src) &&
        /canCustomizeOrders/.test(src) &&
        /me\?\.isAdmin\s*\|\|\s*me\?\.isGlobal/.test(src) &&
        /allowColumnCustomization=\{canCustomizeOrders\}/.test(src),
      'Orders.tsx enables DataTable customization only for admin/global users',
    );
    continue;
  }
  assert(
    !/allowColumnCustomization/.test(src),
    `${f} does not enable DataTable column customization for client users (admin-only, off by default)`,
  );
}

// ── package.json wiring ──
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-datatable-customization-rbac'] ===
    'node scripts/client-portal-datatable-customization-rbac-guard.mjs',
  'package.json exposes test:client-portal-datatable-customization-rbac',
);

if (failed) process.exit(1);
console.log('\nCP-035 DataTable customization RBAC guard passed.');

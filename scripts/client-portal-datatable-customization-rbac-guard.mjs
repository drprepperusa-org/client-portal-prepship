// Structural table customization is an ADMIN privilege; widths are adjustable
// by every desktop/tablet user.
//
// Client users may resize columns for the current session, but cannot toggle or
// reorder them. The Columns chooser, Reset, drag-to-reorder, and persisted
// structural layout remain behind the admin/global `allowColumnCustomization`
// gate, so stale localStorage cannot resurrect hidden/removed customer columns.
import fs from 'node:fs';
import path from 'node:path';
import { readSourceTree, sourceTreeFiles } from './lib/source-tree.mjs';

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

const dt = readSourceTree([
  'portal-client/src/components/ui/DataTable.tsx',
  'portal-client/src/components/ui/data-table',
]);
const hooks = read('portal-client/src/lib/hooks.ts');

// 1. The gate prop exists and defaults OFF.
assert(/allowColumnCustomization\?:\s*boolean/.test(dt), 'DataTable declares an allowColumnCustomization?: boolean prop');
assert(/allowColumnCustomization\s*=\s*false/.test(dt), 'allowColumnCustomization DEFAULTS to false (customer-safe)');

// 2. Customization requires an EXPLICIT opt-in - never inferred from tableId.
assert(
  /const customizable\s*=\s*Boolean\(tableId\)\s*&&\s*allowColumnCustomization/.test(dt),
  'customization requires tableId AND an explicit allowColumnCustomization opt-in (not tableId alone)',
);

// 3. Controls, drag, and persisted layout are gated; width resize is universal.
assert(
  /\{props\.customizable &&\s*\(\s*<DataTableColumnControls\b/.test(dt),
  'the Columns chooser + Reset controls render only when customizable',
);
assert(/const canDrag\s*=\s*customizable\s*&&/.test(dt), 'header drag-to-reorder is gated on customizable');
assert(/const canResize\s*=\s*column\.resizable\s*!==\s*false/.test(dt), 'column resize is available to every desktop/tablet user');
assert(
  /useColumnLayout\(customizable \? tableId : undefined/.test(dt),
  'client resizing is session-only; stale persisted structural layouts are ignored',
);
assert(
  /tabIndex=\{0\}/.test(dt) && /ArrowLeft/.test(dt) && /ArrowRight/.test(dt),
  'resize handles support keyboard width adjustments',
);
assert(!/\{tableId && \(/.test(dt), 'customization controls are no longer gated on tableId alone');

// 4. Every Client Portal DataTable uses the shared admin/global gate.
assert(
  /export function useCanCustomizeTables\(\): boolean/.test(hooks) &&
    /const me = useMe\(\)\.data/.test(hooks) &&
    /Boolean\(me\?\.isAdmin\s*\|\|\s*me\?\.isGlobal\)/.test(hooks),
  'useCanCustomizeTables is the shared admin/global gate for DataTable customization',
);

for (const file of sourceTreeFiles('portal-client/src/pages')) {
  const src = fs.readFileSync(file, 'utf8');
  const label = path.relative(root, file);
  assert(!/<table\b/.test(src), `${label} does not hand-roll native table markup; page tables use DataTable`);
}

const tableUsers = sourceTreeFiles([
  'portal-client/src/pages',
  'portal-client/src/components',
]).filter((file) => !file.startsWith(path.join(root, 'portal-client/src/components/ui/data-table'))
  && file !== path.join(root, 'portal-client/src/components/ui/DataTable.tsx'));

for (const file of tableUsers) {
  const src = fs.readFileSync(file, 'utf8');
  const label = path.relative(root, file);

  const dataTableTags = [...src.matchAll(/<DataTable\b[\s\S]*?\/>/g)].map((m) => m[0]);
  if (dataTableTags.length === 0) continue;

  const directGate = /import\s+\{[^}]*useCanCustomizeTables[^}]*\}\s+from ['"]@\/lib\/hooks['"]/.test(src)
    && /const canCustomizeTables = useCanCustomizeTables\(\);/.test(src);
  const delegatedGate = /canCustomizeTables:\s*boolean/.test(src)
    && /allowColumnCustomization=\{props\.canCustomizeTables\}/.test(src);
  assert(directGate || delegatedGate, `${label} receives the shared admin/global customization gate`);

  for (const [i, tag] of dataTableTags.entries()) {
    const tableLabel = dataTableTags.length === 1 ? label : `${label} DataTable #${i + 1}`;
    assert(/tableId=/.test(tag), `${tableLabel} has a stable tableId for persisted admin layout`);
    assert(
      /allowColumnCustomization=\{(?:canCustomizeTables|props\.canCustomizeTables)\}/.test(tag),
      `${tableLabel} enables column customization only through canCustomizeTables`,
    );
  }
}

// package.json wiring.
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-datatable-customization-rbac'] ===
    'node scripts/client-portal-datatable-customization-rbac-guard.mjs',
  'package.json exposes test:client-portal-datatable-customization-rbac',
);

if (failed) process.exit(1);
console.log('\nCP-035 DataTable customization RBAC guard passed.');

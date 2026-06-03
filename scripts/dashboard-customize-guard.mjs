// Guard: the Dashboard is customizable — an "Edit dashboard" button toggles a
// drag-and-drop reorder mode with hide/show, persisted per user.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── Per-user persisted layout module ──
{
  const lib = read('portal-client/src/lib/dashboardLayout.ts');
  assert(lib.includes('export function loadLayout') && lib.includes('export function saveLayout'), 'layout module loads + saves');
  assert(lib.includes('localStorage') && lib.includes('prepship.dashLayout.'), 'layout persists to a per-user localStorage key');
  assert(lib.includes('function normalize'), 'stored layouts are normalized (tolerates added/removed widgets)');
  assert(lib.includes("'kpis'") && lib.includes("'ordersChart'") && lib.includes("'volumeChart'") && lib.includes("'topSkus'"), 'all dashboard widgets are layout-managed');
}

// ── Dashboard edit mode: button, drag-reorder, hide/show, reset ──
{
  const dash = read('portal-client/src/pages/Dashboard.tsx');
  assert(dash.includes('Edit dashboard'), 'an "Edit dashboard" button exists');
  assert(dash.includes('const [editing, setEditing]'), 'dashboard tracks an edit mode');
  assert(dash.includes('<Reorder.Group') && dash.includes('<Reorder.Item'), 'edit mode uses drag-and-drop reordering');
  assert(dash.includes('onReorder={setOrder}'), 'reordering updates (and persists) the widget order');
  assert(dash.includes('toggleHidden') && dash.includes('resetLayout'), 'widgets can be hidden/shown and the layout reset');
  assert(dash.includes('loadLayout(userId)') && dash.includes('saveLayout(userId, layout)'), 'layout is loaded + saved per signed-in user');
  assert(dash.includes('function renderWidget'), 'widgets render through a single layout-driven renderer');
  assert(dash.includes("openPeek('open')") && dash.includes('<KpiPeekModal') && dash.includes('<ChartDayModal'), 'existing peek + drill-down behavior is preserved');
}

// ── Registered ──
{
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts?.['test:dashboard-customize'] === 'node scripts/dashboard-customize-guard.mjs', 'package.json exposes test:dashboard-customize');
}

if (failed) process.exit(1);
console.log('\nDashboard customization guard passed.');

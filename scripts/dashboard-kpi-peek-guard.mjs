// Guard: the Dashboard KPI cards (Open orders, Shipped, Units, Revenue) open a
// fast, animated "live peek" modal that renders from already-cached query data.
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

// ── StatCard is a keyboard-accessible peek trigger that reports its rect ──
{
  const card = read('portal-client/src/components/ui/StatCard.tsx');
  assert(card.includes('onPeek?:'), 'StatCard accepts an onPeek callback');
  assert(card.includes('getBoundingClientRect()'), 'StatCard reports its on-screen rect (so the modal can grow from it)');
  assert(card.includes("role={interactive ? 'button' : undefined}") && card.includes('tabIndex={interactive ? 0 : undefined}'), 'interactive StatCard is keyboard accessible');
  assert(/e\.key === 'Enter' \|\| e\.key === ' '/.test(card), 'StatCard activates on Enter/Space');
}

// ── Dashboard wires all four KPIs and renders the peek modal from cached data ──
{
  const dash = read('portal-client/src/pages/Dashboard.tsx');
  for (const key of ['open', 'shipped', 'units', 'revenue']) {
    assert(dash.includes(`openPeek('${key}')`), `Dashboard wires the ${key} KPI to a peek`);
  }
  assert(dash.includes('<KpiPeekModal'), 'Dashboard renders KpiPeekModal');
  assert(dash.includes('counts: countRows') && dash.includes('daily: dash.data?.daily'), 'peek modal is fed already-cached dashboard/daily data (no new fetch)');
}

// ── The modal shell: grow-from-card morph, composed from peek/ submodules ──
// (count-up, chart, live list, and per-metric configs were extracted into
//  portal-client/src/components/dashboard/peek/ — each is pinned in its new home below)
{
  const modal = read('portal-client/src/components/dashboard/KpiPeekModal.tsx');
  assert(modal.includes('function originTransform'), 'modal computes a grow-from-card origin transform');
  assert(modal.includes('useReducedMotion'), 'animations respect prefers-reduced-motion');
  assert(modal.includes("from './peek/atoms'") && modal.includes("from './peek/PeekChart'") && modal.includes("from './peek/buildConfig'"), 'modal composes the peek/ submodules (atoms, chart, config)');
}

// ── peek/atoms: count-up headline ──
{
  const atoms = read('portal-client/src/components/dashboard/peek/atoms.tsx');
  assert(atoms.includes('requestAnimationFrame') && atoms.includes('useCountUp'), 'headline value counts up via rAF');
}

// ── peek/PeekChart: interactive trend with click-to-pin detail ──
{
  const chart = read('portal-client/src/components/dashboard/peek/PeekChart.tsx');
  assert(chart.includes('function PeekChart') && chart.includes("from 'recharts'"), 'trend uses an interactive Recharts chart');
  assert(chart.includes('<Tooltip') && chart.includes('activeDot'), 'chart shows on-hover indicators (tooltip + active dot)');
  assert(chart.includes('onClick={pick}') && chart.includes('Tap any day for detail'), 'clicking a day pins a detail readout');
}

// ── peek/OpenOrdersPeek + peek/buildConfig: live list and per-metric configs ──
{
  const live = read('portal-client/src/components/dashboard/peek/OpenOrdersPeek.tsx');
  assert(live.includes('function OpenOrdersPeek') && live.includes("useOrders({ status: 'awaiting_shipment'"), 'Open-orders peek lazy-loads a short live list');
  const config = read('portal-client/src/components/dashboard/peek/buildConfig.tsx');
  for (const key of ['open', 'shipped', 'units', 'revenue']) {
    assert(config.includes(`case '${key}'`), `modal builds a config for the ${key} peek`);
  }
}

// ── Registered ──
{
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts?.['test:dashboard-kpi-peek'] === 'node scripts/dashboard-kpi-peek-guard.mjs', 'package.json exposes test:dashboard-kpi-peek');
}

if (failed) process.exit(1);
console.log('\nDashboard KPI live-peek guard passed.');

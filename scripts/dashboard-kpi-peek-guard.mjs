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

// ── The modal: grow-from-card morph, count-up, self-drawing sparkline ──
{
  const modal = read('portal-client/src/components/dashboard/KpiPeekModal.tsx');
  assert(modal.includes('function originTransform'), 'modal computes a grow-from-card origin transform');
  assert(modal.includes('requestAnimationFrame') && modal.includes('useCountUp'), 'headline value counts up via rAF');
  assert(modal.includes('useReducedMotion'), 'animations respect prefers-reduced-motion');
  assert(modal.includes('function PeekChart') && modal.includes("from 'recharts'"), 'trend uses an interactive Recharts chart');
  assert(modal.includes('<Tooltip') && modal.includes('activeDot'), 'chart shows on-hover indicators (tooltip + active dot)');
  assert(modal.includes('onClick={pick}') && modal.includes('Tap any day for detail'), 'clicking a day pins a detail readout');
  assert(modal.includes('function OpenOrdersPeek') && modal.includes("useOrders({ status: 'awaiting_shipment'"), 'Open-orders peek lazy-loads a short live list');
  for (const key of ['open', 'shipped', 'units', 'revenue']) {
    assert(modal.includes(`case '${key}'`), `modal builds a config for the ${key} peek`);
  }
}

// ── Registered ──
{
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts?.['test:dashboard-kpi-peek'] === 'node scripts/dashboard-kpi-peek-guard.mjs', 'package.json exposes test:dashboard-kpi-peek');
}

if (failed) process.exit(1);
console.log('\nDashboard KPI live-peek guard passed.');

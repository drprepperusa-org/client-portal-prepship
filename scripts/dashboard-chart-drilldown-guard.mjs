// Guard: the Dashboard "Orders over time" and "Shipment volume" charts are
// click-to-drill — clicking a bar opens a detailed day popup.
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

// ── Both charts emit a full-date click and format the axis to MM-DD ──
{
  const charts = read('portal-client/src/components/charts/Charts.tsx');
  assert(charts.includes('onSelectDay?: DaySelect') || /onSelectDay\?:\s*DaySelect/.test(charts), 'charts accept an onSelectDay callback');
  assert(charts.includes('function dayClickHandler') && charts.includes('activeLabel'), 'charts resolve the clicked day from the chart state');
  assert(/OrdersUnitsBarChart\([^)]*onSelectDay/.test(charts), 'OrdersUnitsBarChart is clickable');
  assert(/VolumeBarChart\([^)]*onSelectDay/.test(charts), 'VolumeBarChart is clickable');
  assert(charts.includes('tickFormatter={mmdd}'), 'axis still shows MM-DD while the datum carries the full date');
}

// ── Dashboard wires both charts to the day modal with full-date series ──
{
  const dash = read('portal-client/src/pages/Dashboard.tsx');
  assert(dash.includes("openDay('orders')") && dash.includes("openDay('shipments')"), 'Dashboard wires both charts to a day drill-down');
  assert(dash.includes('<ChartDayModal'), 'Dashboard renders the ChartDayModal');
  assert(dash.includes('day: row.day,') && !/day:\s*row\.day\.slice/.test(dash), 'chart series carry the full YYYY-MM-DD (not pre-sliced)');
}

// ── The day modal shows a detailed breakdown, growing from the click point ──
{
  const modal = read('portal-client/src/components/dashboard/ChartDayModal.tsx');
  assert(modal.includes('function pointTransform'), 'day modal grows from the clicked point');
  for (const field of ['orders', 'units', 'shipped', 'awaiting', 'cancelled', 'shipmentsCount']) {
    assert(modal.includes(field), `day modal surfaces ${field}`);
  }
  assert(modal.includes('Share of period') && modal.includes('vs daily avg') && modal.includes('Busiest rank'), 'day modal includes period-context insights');
  assert(!modal.includes('.reduce(') && !modal.includes('.filter('), 'day modal renders backend-owned context without reductions');
  assert(modal.includes('CountUp') && modal.includes("from './KpiPeekModal'"), 'day modal reuses the shared count-up animation');
}

// ── Registered ──
{
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts?.['test:dashboard-chart-drilldown'] === 'node scripts/dashboard-chart-drilldown-guard.mjs', 'package.json exposes test:dashboard-chart-drilldown');
}

if (failed) process.exit(1);
console.log('\nDashboard chart drill-down guard passed.');

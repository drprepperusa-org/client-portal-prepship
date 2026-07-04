// CP-020 — the Analysis Std/Exp columns must pair the COUNT with the SAME filter
// predicate as the DOLLAR (std_ship_count ↔ std_total) and label the $ as
// allocated shipping cost, not revenue. Static source-pin.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = false;
const assert = (c, m) => {
  if (c) console.log(`PASS ${m}`);
  else {
    console.error(`FAIL ${m}`);
    failed = true;
  }
};

const page = read('portal-client/src/pages/Analysis.tsx');
assert(
  page.includes('num(r.std_ship_count)') && page.includes('num(r.exp_ship_count)'),
  'Std/Exp render std_ship_count / exp_ship_count (predicate-matched to the $ total)',
);
assert(
  !/\{num\(r\.std_orders\)\}/.test(page) && !/\{num\(r\.exp_orders\)\}/.test(page),
  'Std/Exp no longer render the wider std_orders/exp_orders count beside the cost-only $',
);
assert(
  page.includes('sortAccessor: (r) => num(r.std_ship_count)') &&
    page.includes('sortAccessor: (r) => num(r.exp_ship_count)'),
  'Std/Exp sortAccessors sort by the displayed shipment count',
);
assert(
  /allocated shipping COST/i.test(page) && /not revenue/i.test(page),
  'a tooltip labels the Std/Exp $ as allocated shipping cost, not revenue',
);
// Build-safety: the UI tooltip (not the recharts one) is wired in.
assert(
  /Tooltip as InfoTooltip/.test(page) && /<InfoTooltip\b/.test(page),
  'Analysis uses the aliased UI InfoTooltip (avoids the recharts Tooltip collision)',
);

// Frontend TYPE must declare the fields the page reads, or build:web fails.
const api = read('portal-client/src/lib/api.ts');
assert(
  api.includes('std_ship_count') && api.includes('exp_ship_count'),
  'AnalysisSkuRow declares std_ship_count/exp_ship_count',
);

// Backend contract the UI depends on (SQL alias AND row type).
const analysis = read('src/routes/analysis.ts');
assert(
  analysis.includes('as std_ship_count') &&
    analysis.includes('as exp_ship_count') &&
    analysis.includes('as std_total') &&
    analysis.includes('as exp_total'),
  'analysis.ts SQL still emits std_ship_count/exp_ship_count/std_total/exp_total',
);
assert(
  /std_ship_count:\s*number/.test(analysis) && /exp_ship_count:\s*number/.test(analysis),
  'SkuBreakdownRow type still declares std_ship_count/exp_ship_count',
);

const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-analysis-ship-bucket'] ===
    'node scripts/client-portal-analysis-ship-bucket-guard.mjs',
  'package exposes test:client-portal-analysis-ship-bucket',
);

if (failed) process.exit(1);
console.log('\nCP-020 analysis ship-bucket guard passed.');

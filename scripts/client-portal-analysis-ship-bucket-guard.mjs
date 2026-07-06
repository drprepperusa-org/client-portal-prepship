// CP-020 (customer layer SUPERSEDED by CP-035) — the Std/Exp ship-bucket SOT.
//
// CP-020 made the Analysis Std/Exp columns honest: the COUNT (std_ship_count) is
// predicate-matched to the DOLLAR (std_total = allocated shipping cost, not
// revenue). CP-035 then REMOVED those columns from the CUSTOMER Analysis view.
//
// So this guard now pins:
//   1. The customer Analysis page no longer renders the Std/Exp columns (CP-035).
//   2. The BACKEND bucket contract is still intact — the analysis read-model
//      still emits the predicate-matched std/exp count + total fields (retained
//      for admin/operator use), and the frontend row TYPE still declares them.
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

// ── 1. CP-035: the customer Analysis view no longer renders Std/Exp columns ──
const page = read('portal-client/src/pages/Analysis.tsx');
assert(
  !/key:\s*'std'/.test(page) && !/key:\s*'exp'/.test(page),
  'CP-035: the Std/Exp ship columns are removed from the customer Analysis view',
);
assert(
  !page.includes("header: 'Std ship'") && !page.includes("header: 'Exp ship'"),
  'CP-035: no Std ship / Exp ship customer headers remain',
);

// ── 2. Backend bucket contract still intact (retained for admin/operator use) ──
// Frontend row TYPE still declares the fields (harmless; not rendered as a
// customer column, but kept so admin/internal consumers + the SOT stay stable).
const api = read('portal-client/src/lib/api.ts');
assert(
  api.includes('std_ship_count') && api.includes('exp_ship_count'),
  'AnalysisSkuRow still declares std_ship_count / exp_ship_count',
);

// Backend read-model still emits the predicate-matched count + $ total.
const analysis = read('src/routes/analysis.ts');
assert(
  analysis.includes('as std_ship_count') &&
    analysis.includes('as exp_ship_count') &&
    analysis.includes('as std_total') &&
    analysis.includes('as exp_total'),
  'analysis.ts SQL still emits std_ship_count/exp_ship_count/std_total/exp_total (bucket SOT retained)',
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
console.log('\nCP-020/CP-035 analysis ship-bucket guard passed.');

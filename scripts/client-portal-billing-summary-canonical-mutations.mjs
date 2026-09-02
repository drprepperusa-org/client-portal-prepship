// CP-067 — mutation harness for the Billing-list assignment guard, COMMITTED so it can be
// reproduced from the repository alone. Review classified an uncommitted mutation report as
// PLAUSIBLE rather than CONFIRMED, which is the right call: a claim nobody else can re-run is
// a claim.
//
// Every mutation must (1) be PROVEN APPLIED — an anchor that no longer matches is a hard
// failure, not a skip, because a mutation that silently did not apply looks exactly like a
// guard that caught it; (2) turn test:client-portal-billing-summary-canonical RED; (3) be
// restored from the in-memory original, verified byte-identical. Never `git checkout`.
//
// Mutations A and B are review's own, verbatim in effect: both-edge overfetch and one-day
// rejection. They survived the previous guard; they must not survive this one.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MODULE = 'src/lib/client-portal/billing-summary-canonical-keys.ts';
const GUARD = 'scripts/client-portal-billing-summary-canonical-guard.ts';

const MUTATIONS = [
  {
    name: 'no clamp — send the full calendar label',
    edits: [
      ['maxDay(row.periodStart as string, range.fromDay)', '(row.periodStart as string)'],
      ['minDay(row.periodEnd as string, range.toDay)', '(row.periodEnd as string)'],
    ],
  },
  {
    name: 'absence becomes zeros instead of a breach',
    edits: [[
      "if (totals === undefined) return { ok: false, reason: 'canonical_totals_incomplete' };",
      'if (totals === undefined) { rows.push({ row: k.row, totals: { grandTotal: 0 } as unknown as T }); continue; }',
    ]],
  },
  {
    name: 'collapse every period onto the request range (review mutation, round 1)',
    edits: [['const key = `${dateFrom}|${dateTo}`;', 'const key = `${range.fromDay}|${range.toDay}`;']],
  },
  {
    name: 'key every row to -1 (review mutation, round 1)',
    edits: [['const totals = canonicalByPeriod.get(k.key)?.get(k.clientId);', 'const totals = canonicalByPeriod.get(k.key)?.get(-1);']],
  },
  {
    name: 'REVIEW A — clamp the end only when the start was NOT clamped (both-edge overfetch)',
    edits: [[
      'const dateTo = hasEnd ? minDay(row.periodEnd as string, range.toDay) : range.toDay;',
      'const dateTo = hasEnd ? ((row.periodStart as string) < range.fromDay ? (row.periodEnd as string) : minDay(row.periodEnd as string, range.toDay)) : range.toDay;',
    ]],
  },
  {
    name: 'REVIEW B — reject a one-day window (>= instead of >)',
    edits: [[
      "if (dateFrom > dateTo) return { ok: false, reason: 'period_outside_range' };",
      "if (dateFrom >= dateTo) return { ok: false, reason: 'period_outside_range' };",
    ]],
  },
  {
    name: 'calendar-day validation accepts any well-shaped string (2026-02-30 survives)',
    edits: [[
      'return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;',
      'return true;',
    ]],
  },
];

const original = readFileSync(MODULE, 'utf8');
let survived = 0;
let notApplied = 0;

const guardIsGreen = () => {
  try {
    execFileSync('npx', ['tsx', GUARD], { stdio: 'pipe', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
};

// The guard must be GREEN on the unmutated module, or every "caught" below is meaningless —
// a red baseline reports every mutation as killed. This is the abort review hit in cp-059.
if (!guardIsGreen()) {
  console.error('ABORT — the guard is RED before any mutation was applied. Fix the baseline first.');
  process.exit(1);
}
console.log('baseline: guard green on the unmutated module');

for (const m of MUTATIONS) {
  let mutated = original;
  let applied = true;
  for (const [from, to] of m.edits) {
    if (!mutated.includes(from)) { applied = false; break; }
    mutated = mutated.replace(from, to);
  }
  if (!applied || mutated === original) {
    notApplied += 1;
    console.error(`  NOT APPLIED  ${m.name}\n               an anchor no longer matches — the module changed under the harness`);
    continue;
  }
  writeFileSync(MODULE, mutated);
  const green = guardIsGreen();
  writeFileSync(MODULE, original);
  if (readFileSync(MODULE, 'utf8') !== original) {
    console.error('RESTORE FAILED — module differs from original; stopping');
    process.exit(1);
  }
  if (green) { survived += 1; console.error(`  SURVIVED     ${m.name}`); }
  else console.log(`  killed       ${m.name}`);
}

console.log(`\n${MUTATIONS.length - survived - notApplied}/${MUTATIONS.length} mutations killed, ${notApplied} not applied`);
if (survived || notApplied) {
  console.error('\n✖ client-portal billing-summary canonical mutation harness FAILED');
  process.exit(1);
}
console.log('\nPASS client-portal billing-summary canonical mutations — every mutation dies, restore verified');

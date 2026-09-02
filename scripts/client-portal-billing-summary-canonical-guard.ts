/**
 * CP-067 — the Billing list's (client, period) -> canonical-totals assignment, EXECUTED.
 *
 * Review defeated the previous CP guards twice while they stayed green: keying every row to
 * `-1` zeroed the whole list, and collapsing every period onto the request range double-counted
 * the footer. Those guards asserted that a fetch call and some tokens EXISTED. They could not
 * see what was assigned to what, because the logic lived inside a route that needs a database.
 *
 * The logic now lives in billing-summary-canonical-keys.ts and needs nothing, so every case
 * below runs it for real. The two review mutations are re-expressed as outcome checks: a
 * wrong key, or a period that was not clamped, produces a DIFFERENT KEY here and fails.
 */
import {
  assignCanonicalTotals,
  keyBillingSummaryRows,
} from '../src/lib/client-portal/billing-summary-canonical-keys.js';

let failed = false;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { failed = true; console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
};
const keysOf = (r: ReturnType<typeof keyBillingSummaryRows>) =>
  r.ok ? r.keyed.map((k) => `${k.clientId}@${k.key}`) : `breach:${r.reason}`;

// ── 1. THE LIVE COUNTEREXAMPLE, exactly as review stated it ────────────────
// A rolling range Aug 4 -> Sep 2. The read model labels rows with WHOLE halves.
{
  const range = { fromDay: '2026-08-04', toDay: '2026-09-02' };
  const rows = [
    { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-15' },
    { clientId: 4, periodStart: '2026-08-16', periodEnd: '2026-08-31' },
    { clientId: 4, periodStart: '2026-09-01', periodEnd: '2026-09-15' },
  ];
  const r = keyBillingSummaryRows(rows, range);
  check('rolling range: the first half is CLAMPED to start at the selected start (Aug 4, not Aug 1)',
    r.ok && r.keyed[0]?.key === '2026-08-04|2026-08-15', String(keysOf(r)));
  check('rolling range: a fully-inside half is untouched',
    r.ok && r.keyed[1]?.key === '2026-08-16|2026-08-31', String(keysOf(r)));
  check('rolling range: the last half is CLAMPED to end at the selected end (Sep 2, not Sep 15)',
    r.ok && r.keyed[2]?.key === '2026-09-01|2026-09-02', String(keysOf(r)));
  check('one upstream call per DISTINCT clamped period, not per row',
    r.ok && r.periods.size === 3 && [...r.periods.values()].every((p) => p.clientIds.length === 1),
    r.ok ? `${r.periods.size} periods` : String(keysOf(r)));
  check('the periods the caller will send are the clamped ones',
    r.ok && [...r.periods.keys()].join(',') === '2026-08-04|2026-08-15,2026-08-16|2026-08-31,2026-09-01|2026-09-02',
    r.ok ? [...r.periods.keys()].join(',') : String(keysOf(r)));
}

// ── 2. granularity=month, partial first and last months ─────────────────────
{
  const range = { fromDay: '2026-08-04', toDay: '2026-09-02' };
  const r = keyBillingSummaryRows([
    { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    { clientId: 4, periodStart: '2026-09-01', periodEnd: '2026-09-30' },
  ], range);
  check('partial months are clamped on both ends',
    r.ok && r.keyed.map((k) => k.key).join(',') === '2026-08-04|2026-08-31,2026-09-01|2026-09-02',
    String(keysOf(r)));
}

// ── 3. Cross-month ranges split into DISTINCT periods, never merged ─────────
{
  const range = { fromDay: '2026-07-20', toDay: '2026-08-10' };
  const r = keyBillingSummaryRows([
    { clientId: 4, periodStart: '2026-07-16', periodEnd: '2026-07-31' },
    { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-15' },
  ], range);
  check('cross-month: two periods stay two keys and both are clamped',
    r.ok && r.periods.size === 2 && r.keyed.map((k) => k.key).join(',') === '2026-07-20|2026-07-31,2026-08-01|2026-08-10',
    String(keysOf(r)));
}

// ── 4. Plain (ungrouped) rows carry no period and key to the request range ──
{
  const range = { fromDay: '2026-08-01', toDay: '2026-08-31' };
  const r = keyBillingSummaryRows([{ clientId: 4 }, { clientId: 9 }], range);
  check('ungrouped rows key to the request range, one period for all clients',
    r.ok && r.periods.size === 1 && r.periods.get('2026-08-01|2026-08-31')?.clientIds.join(',') === '4,9',
    String(keysOf(r)));
}

// ── 5. Producer-contract breaches are ERRORS, never repaired rows ───────────
{
  const range = { fromDay: '2026-08-01', toDay: '2026-08-31' };
  const breach = (rows: unknown[]) => { const r = keyBillingSummaryRows(rows as never, range); return r.ok ? 'ok' : r.reason; };
  check('a STRING client id is a breach, not coerced into a financial join',
    breach([{ clientId: '4', periodStart: '2026-08-01', periodEnd: '2026-08-15' }]) === 'client_id_not_integer');
  check('a non-integer client id is a breach',
    breach([{ clientId: 4.5 }]) === 'client_id_not_integer');
  check('a period with only ONE bound is a breach (both-or-neither)',
    breach([{ clientId: 4, periodStart: '2026-08-01' }]) === 'period_bounds_incomplete'
    && breach([{ clientId: 4, periodEnd: '2026-08-15' }]) === 'period_bounds_incomplete');
  check('a period entirely OUTSIDE the range is a breach, not an empty window',
    breach([{ clientId: 4, periodStart: '2026-07-16', periodEnd: '2026-07-31' }]) === 'period_outside_range');
  check('two rows for one (client, period) are a breach — they would double the footer',
    breach([
      { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-15' },
      { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-15' },
    ]) === 'duplicate_client_period');
  check('two rows for one client in DIFFERENT periods are fine',
    breach([
      { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-15' },
      { clientId: 4, periodStart: '2026-08-16', periodEnd: '2026-08-31' },
    ]) === 'ok');
}

// ── 6. ASSIGNMENT: each row gets ITS OWN period's totals ───────────────────
// This is the check that kills both review mutations. Two periods carry DIFFERENT totals; if
// the key were wrong (`get(-1)`) nothing is found, and if the periods were collapsed the same
// totals would land on both rows.
{
  const range = { fromDay: '2026-08-01', toDay: '2026-08-31' };
  const k = keyBillingSummaryRows([
    { clientId: 4, periodStart: '2026-08-01', periodEnd: '2026-08-15', label: 'H1' },
    { clientId: 4, periodStart: '2026-08-16', periodEnd: '2026-08-31', label: 'H2' },
  ], range);
  if (!k.ok) { check('assignment fixture keys cleanly', false, k.reason); }
  else {
    const canonical = new Map([
      ['2026-08-01|2026-08-15', new Map([[4, { grandTotal: 100 }]])],
      ['2026-08-16|2026-08-31', new Map([[4, { grandTotal: 250 }]])],
    ]);
    const a = assignCanonicalTotals(k.keyed, canonical);
    check('each row receives its OWN period\'s totals, not another period\'s',
      a.ok && a.rows.map((r) => `${r.row.label}=${r.totals.grandTotal}`).join(',') === 'H1=100,H2=250',
      a.ok ? a.rows.map((r) => `${r.row.label}=${r.totals.grandTotal}`).join(',') : a.reason);
    check('the footer would sum 350, not 200 or 500 — no collapse, no duplication',
      a.ok && a.rows.reduce((s, r) => s + r.totals.grandTotal, 0) === 350);

    // A requested client ABSENT from the canonical answer fails the whole assignment.
    const missing = new Map([
      ['2026-08-01|2026-08-15', new Map([[4, { grandTotal: 100 }]])],
      ['2026-08-16|2026-08-31', new Map<number, { grandTotal: number }>()],
    ]);
    const m = assignCanonicalTotals(k.keyed, missing);
    check('a row whose client is ABSENT from the canonical answer is a breach, never $0.00',
      !m.ok && m.reason === 'canonical_totals_incomplete', m.ok ? 'assigned' : m.reason);

    // The wrong-key mutation, expressed as an outcome: a map keyed by anything but the clamped
    // period/client cannot satisfy the assignment.
    const wrongKey = new Map([['-1|-1', new Map([[-1, { grandTotal: 100 }]])]]);
    const w = assignCanonicalTotals(k.keyed, wrongKey);
    check('a mis-keyed canonical map cannot be assigned (the get(-1) mutation is an error, not zeros)',
      !w.ok, w.ok ? 'assigned from a wrong key' : w.reason);
  }
}

// ── 7. The route is THIN: it delegates to this module and has no `?? 0` money fallback ──
{
  const fs = await import('node:fs');
  const route = fs.readFileSync('src/routes/client-portal/invoices.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  check('the route keys rows through keyBillingSummaryRows', /keyBillingSummaryRows\(/.test(route));
  check('the route assigns through assignCanonicalTotals', /assignCanonicalTotals\(/.test(route));
  check('the route has NO `?? 0` fallback on canonical money',
    !/totals\?\.\w+\s*\?\?\s*0/.test(route),
    'a `?? 0` after a canonical fetch turns an absent client into a confident wrong number');
  check('the route does not re-derive the period key itself',
    !/periodStart \?\? range\.fromDay/.test(route) && !/periodOf\(/.test(route),
    'period keying must live in the pure module, or it cannot be tested');
}

if (failed) { console.error('\n✖ client-portal billing-summary canonical assignment guard FAILED'); process.exit(1); }
console.log('\nPASS client-portal billing-summary canonical assignment');

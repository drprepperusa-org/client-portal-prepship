/**
 * CP-063 — the staff billing-date panel shows the return's CURRENT billing date and
 * reflects a saved correction, instead of a blank form.
 *
 * Placement: the effective billing date is backend truth —
 * coalesce(billing_date_override, created_at), the same expression PS-487 uses. The Client
 * Portal returns read model surfaces it on the detail DTO; the staff panel DISPLAYS it and
 * re-reads it after a save. The panel never owns or derives the billing date, and the
 * correction RULE stays PS-487-owned (the portal proxies the save).
 *
 * Offline/pure: source inspection only. No DB, network, provider call, or postage.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const schema = read('src/db/schema/returns.ts');
const reads = read('src/routes/client-portal/returns/reads.ts');
const contract = read('src/lib/client-portal/contracts/returns.ts');
const drawer = read('portal-client/src/components/returns/ReturnDetailDrawer.tsx');
const panel = read('portal-client/src/components/returns/ReturnBillingDatePanel.tsx');
const pkg = JSON.parse(read('package.json'));

// ── Backend read model surfaces the effective billing date ──
check('the CP returns schema maps the PS-owned billing_date_override column (read only)', () => {
  assert(
    /billingDateOverride:\s*timestamp\('billing_date_override'/.test(schema),
    'the schema must map billing_date_override so the read model can coalesce it',
  );
  // Only the DATE is read here; the override actor/reason audit stays PS-owned.
  assert(
    !/billingDateOverrideBy|billingDateOverrideReason/.test(schema),
    'the override audit (who/why) stays PS-owned and is not mapped into the portal',
  );
});

check('the detail read model derives the effective billing DAY, gated to staff', () => {
  const code = stripComments(reads);
  // Backend derives the canonical UTC DAY (isoDay) once, so the FE never re-derives it two ways,
  // and gates it to scope.isGlobal (staff) with null for clients so a correction cannot be inferred.
  assert(
    /effectiveBillingDate:\s*scope\.isGlobal[\s\S]{0,90}?isoDay\(row\.ret\.billingDateOverride\s*\?\?\s*row\.ret\.createdAt\)[\s\S]{0,20}?:\s*null/.test(code),
    'the detail DTO must surface isoDay(billing_date_override ?? created_at) gated on scope.isGlobal, null otherwise',
  );
});

check('the PortalReturnDetail contract exposes effectiveBillingDate', () => {
  assert(
    /effectiveBillingDate:\s*string\s*\|\s*null/.test(contract),
    'the shared contract must type the new field',
  );
});

// ── FE displays it, does not own it ──
check('the drawer passes the backend value into the panel', () => {
  assert(
    /<ReturnBillingDatePanel[^>]*currentBillingDate=\{detail\.effectiveBillingDate\}/.test(drawer),
    'the panel must receive the backend-derived current billing date',
  );
});

check('the panel accepts + displays the current billing day (AC-1)', () => {
  assert(/currentBillingDate:\s*string\s*\|\s*null/.test(panel), 'the panel takes the current day as a prop');
  assert(/Current billing date:/.test(panel), 'the panel labels the current billing date');
  // Calendar-safe shortDay, NOT the local-tz shortDate — the label must agree with the input.
  assert(/shortDay\(currentBillingDate\)/.test(panel), 'the label renders via the calendar-safe shortDay');
  assert(!/shortDate\(currentBillingDate\)/.test(panel), 'the label must NOT use local-tz shortDate (off-by-one in US zones)');
});

check('the label and the date input agree on the UTC day (no local-tz off-by-one)', () => {
  // The input pre-fills from the UTC day slice; the label formats the SAME value via shortDay,
  // which anchors a YYYY-MM-DD to LOCAL midnight of that exact day. shortDate() would parse the
  // day as UTC midnight and render the PREVIOUS day in US timezones — the defect CP-063 fixes.
  const status = read('portal-client/src/lib/status.ts');
  assert(/export function shortDay\(/.test(status), 'status.ts exposes a calendar-safe shortDay formatter');
  assert(/new Date\(`\$\{value\.slice\(0, 10\)\}T00:00:00`\)/.test(status),
    'shortDay anchors the day to LOCAL midnight so the rendered calendar day matches in any timezone');
  assert(/currentBillingDate\.slice\(0, 10\)/.test(panel),
    'the date input pre-fills from the same UTC day the label renders');
});

check('the panel re-syncs to the backend value after a save, not a blank form (AC-2)', () => {
  assert(
    /const currentDay = currentBillingDate \? currentBillingDate\.slice\(0, 10\)/.test(panel),
    'the current day is derived from the backend value, not owned by the panel',
  );
  assert(/useEffect\(/.test(panel), 'the panel re-syncs via an effect');
  assert(/setNewBillingDay\(currentDay\)/.test(panel), 'the effect resets the input to the current value');
  assert(/\[currentDay\]/.test(panel), 'the effect fires when the backend value changes (after a refetch)');
});

check('the panel stays staff-only and PS-487 owns the rule (AC-3/AC-4)', () => {
  assert(
    /if \(!me\?\.isAdmin && !me\?\.isGlobal\) return null/.test(panel),
    'client users must not see the panel',
  );
  assert(/updateReturnBillingDate/.test(panel), 'the save still proxies to PS-487');
  // The panel must not reason about finalized-period money — that is PS-487's, and it must
  // not re-derive the billing date itself (no coalesce lives in the FE).
  for (const forbidden of ['finalizationId', 'creditNote', 'adjustmentKind', 'billingPeriodId', 'coalesce']) {
    assert(!stripComments(panel).includes(forbidden), `the panel must not own ${forbidden}`);
  }
});

check('package.json exposes test:client-portal-returns-cp063', () => {
  assert(
    pkg.scripts?.['test:client-portal-returns-cp063'] === 'node scripts/client-portal-returns-cp063-guard.mjs',
    'the guard must be wired into package.json',
  );
});

if (failures > 0) {
  console.error(`\nFAIL CP-063 billing-date current-value guard (${failures} failing)`);
  process.exit(1);
}
console.log('\nPASS CP-063 billing-date current-value guard');

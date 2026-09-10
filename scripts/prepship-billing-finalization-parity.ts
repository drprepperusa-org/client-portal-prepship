/**
 * CP-070 — cross-repo contract gate for PrepShip's billing finalization verdict.
 *
 * contracts/prepship-billing-finalization-coverage.json carries PrepShip's recorded answers
 * (prepship-v4 contracts/billing-finalization-coverage.v1.json, asserted equal to the REAL
 * route by its PG17 fixtures). This gate closes the chain on the portal side:
 *
 *   LOCAL (always) — the REAL proxy and parser (prepship-billing-finalization-proxy.ts) run over
 *     every pinned case: each verdict passes through unchanged, each denial keeps its status
 *     without its detail, anything else is "unable to confirm", and a closed verdict with any
 *     field added is refused.
 *   REMOTE (PREPSHIP_CONTRACT_TOKEN) — the pinned upstream file at the pinned ref still equals
 *     this copy. prepship-v4 is private, so the default GITHUB_TOKEN cannot read it. Without the
 *     token this reports NOT ARMED and exits non-zero unless --allow-unarmed is passed, so a
 *     missing token can never look like a passing gate.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ??= 'postgres://offline:offline@127.0.0.1:1/offline';
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ??= 'parity-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'parity-service-key';
process.env.SUPABASE_JWT_SECRET ??= 'parity-jwt-secret';
process.env.PREPSHIP_API_URL = 'http://prepship.parity.test';

const { fetchBillingFinalizationCoverage } = await import('../src/lib/client-portal/prepship-billing-finalization-proxy');

type PinnedCase = { name: string; httpStatus: number; body: Record<string, unknown> };
const contract = JSON.parse(readFileSync('contracts/prepship-billing-finalization-coverage.json', 'utf8')) as {
  upstream: { repo: string; ref: string; path: string };
  request: { dateFrom: string; dateTo: string };
  cases: PinnedCase[];
};
const allowUnarmed = process.argv.includes('--allow-unarmed');
const TODAY = '2026-09-11';
let failed = false;
const pass = (message: string) => console.log(`PASS ${message}`);
const fail = (message: string) => { console.error(`FAIL ${message}`); failed = true; };

const withToday = (body: Record<string, unknown>) => (body.today === 'TODAY' ? { ...body, today: TODAY } : body);
const answer = async (httpStatus: number, body: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status: httpStatus, headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  return fetchBillingFinalizationCoverage('Bearer parity', contract.request);
};

// ── LOCAL: the real parser over every recorded producer answer ─────────────────
for (const pinned of contract.cases) {
  try {
    const body = withToday(pinned.body);
    const result = await answer(pinned.httpStatus, body);
    if (pinned.httpStatus === 200) {
      assert.deepEqual(result, { ok: true, coverage: body });
    } else if (pinned.httpStatus === 403 || pinned.httpStatus === 404 || pinned.httpStatus === 401) {
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.status, pinned.httpStatus);
      assert.ok(!JSON.stringify(result).includes(String(pinned.body.error)) || pinned.body.error === 'Not found');
    } else {
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.status, 502);
      assert.ok(!JSON.stringify(result).includes('closed'));
    }
    pass(`local: pinned '${pinned.name}' (${pinned.httpStatus}) is handled by the real proxy as contracted`);
  } catch (error) {
    fail(`local: pinned '${pinned.name}': ${error instanceof Error ? error.message : String(error)}`);
  }
}
const closed = contract.cases.find((c) => c.name === 'closed');
if (!closed) fail('local: the contract must pin a closed case');
else {
  const widened = await answer(200, { ...withToday(closed.body), openRanges: [] });
  if (widened.ok) fail('local: a closed verdict with an extra field was accepted');
  else pass('local: a closed verdict carrying any field beyond the v1 DTO is refused');
}

// ── REMOTE: the pinned upstream file has not moved ─────────────────────────────
const token = process.env.PREPSHIP_CONTRACT_TOKEN || '';
if (!token) {
  const message = 'NOT ARMED — PREPSHIP_CONTRACT_TOKEN is not set, so upstream drift cannot be detected.';
  if (allowUnarmed) console.warn(`WARN ${message}`);
  else fail(message);
} else {
  try {
    const { repo, ref, path } = contract.upstream;
    const raw = execFileSync('gh', ['api', `repos/${repo}/contents/${path}?ref=${ref}`, '--jq', '.content'], {
      encoding: 'utf8', env: { ...process.env, GH_TOKEN: token },
    });
    const upstream = JSON.parse(Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8')) as { cases: PinnedCase[] };
    assert.deepEqual(upstream.cases, contract.cases);
    pass(`remote: ${repo}@${ref.slice(0, 12)}:${path} equals the pinned cases`);
  } catch (error) {
    fail(`remote: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(failed ? '\nFAIL CP-070 PrepShip finalization contract parity' : '\nPASS CP-070 PrepShip finalization contract parity');
process.exit(failed ? 1 : 0);

/* CP-070 — the Billing finalization verdict route and its PrepShip proxy, through the real Hono app.
 *
 * PrepShip is stubbed at fetch. Coverage is PrepShip's and is proved in prepship-v4's PG17
 * fixtures; there is no coverage math in this repo to test. What this proves is what the portal
 * does with every answer: the route gates financial visibility and input shape BEFORE any upstream
 * call, forwards the caller's bearer and only the applied inclusive days, passes a valid verdict
 * through unchanged, and turns every other outcome into "unable to confirm" — never `closed`.
 *
 * Uses the shared integration harness so it runs in the hosted client-portal-integration job.
 * No production data, no billing generation, no network beyond the stub.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.PREPSHIP_API_URL = 'http://prepship.test';

const billingApp = (await import('../../src/routes/client-portal/billing')).default;
const { parseBillingFinalizationCoverage } = await import(
  '../../src/lib/client-portal/prepship-billing-finalization-proxy'
);
const { env } = await import('../../src/lib/env');

let checks = 0;
const ok = (label: string) => { checks += 1; console.log(`ok   CP-070 ${label}`); };

const BEARER = 'Bearer cp070-caller-token';
const RANGE = { dateFrom: '2026-08-01', dateTo: '2026-08-15' };
const verdict = (status: string, over: Record<string, unknown> = {}) =>
  ({ status, dateFrom: RANGE.dateFrom, dateTo: RANGE.dateTo, today: '2026-09-11', ...over });

const upstream = {
  calls: 0,
  url: new URL('http://unset.test'),
  headers: new Headers(),
  signal: undefined as AbortSignal | undefined | null,
};
function stub(respond: () => Response | Promise<Response>) {
  upstream.calls = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    upstream.calls += 1;
    upstream.url = new URL(typeof input === 'string' ? input : String((input as { url?: string }).url ?? input));
    upstream.headers = new Headers(init?.headers ?? {});
    upstream.signal = init?.signal;
    return respond();
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const mount = (vars: Record<string, unknown>) => {
  const harness = new Hono();
  harness.use('*', async (c, next) => {
    for (const [key, value] of Object.entries(vars)) c.set(key as never, value as never);
    await next();
  });
  harness.route('/', billingApp);
  return harness;
};
const financials = {
  userId: 'cp070-route', email: 'route@cp070.test', role: 'client',
  permissions: ['financials:read'], clientIds: [7], storeIds: [],
};
const get = async (
  params: Record<string, string> = RANGE,
  vars: Record<string, unknown> = financials,
  headers: Record<string, string> = { authorization: BEARER },
) => {
  const response = await mount(vars).request(
    `/billing/finalization-coverage?${new URLSearchParams(params).toString()}`,
    { headers },
  );
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* compared as text */ }
  return { response, body, text };
};

try {
  // ── 1. A valid verdict passes through unchanged ─────────────────────────────
  for (const status of ['open', 'mixed', 'closed', 'unavailable']) {
    stub(() => json(verdict(status)));
    const result = await get();
    assert.equal(result.response.status, 200, `${status}: ${result.text}`);
    assert.deepEqual(result.body, verdict(status));
    assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
    ok(`PrepShip '${status}' reaches the caller unchanged, private and uncached`);
  }

  // ── 2. The wire carries the bearer and the applied days, nothing else ──────
  stub(() => json(verdict('open')));
  await get(RANGE, financials, { authorization: BEARER, 'x-request-id': 'cp070-req-1' });
  assert.equal(upstream.url.pathname, '/billing/finalization-coverage');
  assert.deepEqual([...upstream.url.searchParams.entries()].sort(), [['dateFrom', '2026-08-01'], ['dateTo', '2026-08-15']]);
  assert.equal(upstream.headers.get('authorization'), BEARER);
  assert.equal(upstream.headers.get('x-request-id'), 'cp070-req-1');
  assert.ok(upstream.signal instanceof AbortSignal, 'the upstream call must be cancellable');
  ok('forwards the bearer verbatim, x-request-id, a cancellation signal and only the inclusive applied days');

  stub(() => json(verdict('closed')));
  await get({ ...RANGE, clientId: '12' });
  assert.equal(upstream.url.searchParams.get('clientId'), '12');
  assert.equal(upstream.url.searchParams.get('clientIds'), null, 'the portal never sends a client list');
  ok('an explicit client filter is forwarded as a narrowing clientId, never as a client list');

  // ── 3. Every other upstream outcome is "unable to confirm", never closed ───
  const unconfirmed: Array<[string, () => Response | Promise<Response>]> = [
    ['a 500', () => json({ error: 'boom' }, 500)],
    ['a 400', () => json({ error: 'Choose valid start and end dates' }, 400)],
    ['a network failure', () => { throw new TypeError('fetch failed'); }],
    ['a timeout', () => { throw new DOMException('timed out', 'TimeoutError'); }],
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    ['an array body', () => json([verdict('closed')])],
    ['an extra field', () => json({ ...verdict('closed'), canFinalize: false })],
    ['a missing today', () => json({ status: 'closed', dateFrom: RANGE.dateFrom, dateTo: RANGE.dateTo })],
    ['an unknown status', () => json(verdict('finalized'))],
    ['another date range', () => json(verdict('closed', { dateFrom: '2026-08-02' }))],
    ['an instant instead of a day', () => json(verdict('closed', { today: '2026-09-11T00:00:00Z' }))],
  ];
  for (const [label, respond] of unconfirmed) {
    stub(respond);
    const result = await get();
    assert.equal(result.response.status, 502, `${label}: ${result.response.status} ${result.text}`);
    assert.equal(result.body?.error, 'Unable to confirm billing finalization.');
    assert.equal(result.body?.status, undefined, `${label} must not carry a verdict`);
    assert.ok(!result.text.includes('closed'), `${label} must never say closed`);
    ok(`${label} upstream is unable-to-confirm (502), never a verdict`);
  }

  const savedUrl = env.PREPSHIP_API_URL;
  (env as { PREPSHIP_API_URL?: string }).PREPSHIP_API_URL = '';
  stub(() => json(verdict('closed')));
  const unconfigured = await get();
  (env as { PREPSHIP_API_URL?: string }).PREPSHIP_API_URL = savedUrl;
  assert.equal(unconfigured.response.status, 503);
  assert.equal(upstream.calls, 0);
  ok('a missing PREPSHIP_API_URL is 503 unable-to-confirm with no upstream call');

  // ── 4. Authorization failures keep their status and lose their detail ──────
  for (const status of [401, 403, 404]) {
    stub(() => json({ error: `Client 12 not found for token of user 99 (${status})` }, status));
    const result = await get({ ...RANGE, clientId: '12' });
    assert.equal(result.response.status, status);
    assert.ok(!result.text.includes('Client 12') && !result.text.includes('user 99'), `upstream detail leaked: ${result.text}`);
    ok(`an upstream ${status} is forwarded as ${status} without its detail`);
  }
  stub(() => json({ error: 'a' }, 403));
  const denied403 = await get({ ...RANGE, clientId: '12' });
  stub(() => json({ error: 'b' }, 404));
  const denied404 = await get({ ...RANGE, clientId: '12' });
  assert.equal(denied403.text, denied404.text);
  ok('out-of-scope and nonexistent clients read identically');

  // ── 5. The portal refuses before any upstream call ─────────────────────────
  const refusedBeforeUpstream: Array<[string, number, Parameters<typeof get>]> = [
    ['no financial visibility', 403, [RANGE, { ...financials, permissions: [] }]],
    ['no client or store claims', 403, [RANGE, { ...financials, clientIds: [], storeIds: [] }]],
    ['no bearer', 401, [RANGE, financials, {}]],
    ['missing dateTo', 400, [{ dateFrom: '2026-08-01' }]],
    ['reversed days', 400, [{ dateFrom: '2026-08-15', dateTo: '2026-08-01' }]],
    ['an impossible day', 400, [{ dateFrom: '2026-02-30', dateTo: '2026-03-01' }]],
    ['an instant', 400, [{ dateFrom: '2026-08-01T00:00:00Z', dateTo: '2026-08-15' }]],
    ['year zero', 400, [{ dateFrom: '0000-01-01', dateTo: '0000-01-15' }]],
    ['a non-numeric clientId', 400, [{ ...RANGE, clientId: 'abc' }]],
    ['a zero clientId', 400, [{ ...RANGE, clientId: '0' }]],
    ['a negative clientId', 400, [{ ...RANGE, clientId: '-3' }]],
  ];
  for (const [label, status, args] of refusedBeforeUpstream) {
    stub(() => json(verdict('closed')));
    const result = await get(...args);
    assert.equal(result.response.status, status, `${label}: ${result.text}`);
    assert.equal(upstream.calls, 0, `${label} must not reach PrepShip`);
    assert.ok(!result.text.includes('closed'));
    ok(`${label} is ${status} before any upstream call`);
  }

  // ── 6. The parser accepts exactly the frozen DTO ───────────────────────────
  assert.deepEqual(parseBillingFinalizationCoverage(verdict('mixed'), RANGE), verdict('mixed'));
  for (const bad of [null, 'closed', [], {}, { ...verdict('closed'), extra: 1 }, verdict('closed', { dateTo: '2026-08-16' })]) {
    assert.equal(parseBillingFinalizationCoverage(bad, RANGE), null);
  }
  ok('the parser accepts the exact v1 DTO for the requested days and nothing else');

  // ── 7. No coverage source of truth in this repo ────────────────────────────
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of ['src/lib/client-portal/prepship-billing-finalization-proxy.ts', 'src/routes/client-portal/billing.ts']) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.ok(!/billing_finalizations|billingFinalizations/.test(code), `${file} must not read finalization records`);
  }
  ok('neither the proxy nor the route reads finalization records');

  console.log(`\nPASS CP-070 finalization verdict route + proxy: ${checks} checks`);
  process.exit(0);
} catch (error) {
  console.error('\nFAIL CP-070 finalization verdict route + proxy:', error instanceof Error ? error.stack : error);
  process.exit(1);
}

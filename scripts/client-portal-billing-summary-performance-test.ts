import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Hono } from 'hono';
import { loadFixtureModule } from './lib/load-fixture-module';
import * as keys from '../src/lib/client-portal/billing-summary-canonical-keys';
import * as days from '../src/lib/client-portal/billing-day';

// Execute the actual route; only I/O and unrelated invoice surfaces are replaced.
// The delayed upstream models network latency, not production database throughput.
const periods = [
  ['2026-06-16', '2026-06-30'], ['2026-07-01', '2026-07-15'],
  ['2026-07-16', '2026-07-31'], ['2026-08-01', '2026-08-15'],
  ['2026-08-16', '2026-08-31'], ['2026-09-01', '2026-09-15'],
  ['2026-09-16', '2026-09-30'],
];
const rows = periods.flatMap(([periodStart, periodEnd]) => [7, 8].map(clientId => ({
  clientId, clientName: `Fixture ${clientId}`, periodStart, periodEnd,
  orders: 999, rowTotal: '999999', // Must be replaced, never used as fallback.
})));
const scope = { userId: 'offline', canViewFinancials: true, clientIds: [7, 8], storeIds: [77], isGlobal: false };
const denied = { ok: false, status: 403, error: 'Not found', code: 'forbidden' };
const calls: Array<{ auth: string; query: any; requestId: string }> = [];
const audits: string[] = [];
let active = 0, peak = 0, failPeriod = '', missing = false, inputRows = rows;
const totalsFor = (clientId: number, day: string) => {
  const amount = clientId * 100 + Number(day.slice(8));
  return { orderCount: 1, pickPackTotal: amount, additionalTotal: 0, packageTotal: 0,
    shippingTotal: 0, storageTotal: 0, returnPostageTotal: 0, returnProcessingTotal: 0, grandTotal: amount };
};
const readIdentity = async (receivedScope: unknown) => { assert.equal(receivedScope, scope); return inputRows; };
const route = loadFixtureModule('src/routes/client-portal/invoices.ts', {
  '../../db/client': { db: {} },
  '../../db/schema/clients': { clients: {} },
  '../../lib/client-portal/audit': { recordPortalAudit: async (event: string) => { audits.push(event); } },
  '../../lib/client-portal/billing-day': days,
  '../../lib/client-portal/scope': { isClientPortalScope: (value: unknown) => value === scope },
  '../../lib/client-portal/predicates': {},
  '../../lib/client-portal/invoice-html': {},
  '../../lib/client-portal/billing-summary-canonical-keys': keys,
  '../../lib/client-portal/read-models/invoice-details': { portalInvoicePeriodSummary: readIdentity, portalInvoiceSummary: readIdentity },
  '../../lib/client-portal/read-models/canonical-invoice-events': {},
  '../../lib/client-portal/query-params': {
    scopeOrResponse: () => scope,
    requestedClientId: (c: any) => c.req.query('clientId') ? Number(c.req.query('clientId')) : undefined,
  },
  '../../lib/client-portal/prepship-invoice-totals-proxy': {
    fetchCanonicalInvoiceTotals: async (auth: string, query: any, requestId: string) => {
      calls.push({ auth, query, requestId }); active++; peak = Math.max(peak, active);
      // Alternating latency exercises responses completing in a different order.
      await new Promise(resolve => setTimeout(resolve, query.dateFrom.endsWith('01') ? 80 : 120));
      active--;
      if (query.dateFrom === failPeriod) return denied;
      return { ok: true, byClient: new Map(query.clientIds.filter((id: number) => !missing || id !== 8)
        .map((id: number) => [id, totalsFor(id, query.dateFrom)])) };
    },
  },
}).default;
const app = new Hono().route('/', route);
const request = (authorization = 'Bearer offline', query = '') => app.request(
  `/invoice-summary?dateFrom=2026-06-20&dateTo=2026-09-18&groupBy=period${query}`,
  { headers: { ...(authorization ? { authorization } : {}), 'x-request-id': 'fixture-request' } },
);

const started = performance.now();
const response = await request();
const elapsedMs = Math.round(performance.now() - started);
assert.equal(response.status, 200);
const body = await response.json() as any;
assert.equal(body.data.length, 14);
assert.equal(calls.length, 7, 'one read per distinct period, not one per client row');
assert.deepEqual(calls[0].query, { clientIds: [7, 8], dateFrom: '2026-06-20', dateTo: '2026-06-30' });
assert.equal(calls.at(-1)!.query.dateTo, '2026-09-18');
assert.ok(calls.every(call => call.auth === 'Bearer offline' && call.requestId === 'fixture-request'));
for (const row of body.data) {
  const start = row.periodStart < '2026-06-20' ? '2026-06-20' : row.periodStart;
  assert.equal(row.rowTotal, String(totalsFor(row.clientId, start).grandTotal));
}
assert.equal(body.totals.rowTotal, body.data.reduce((sum: number, row: any) => sum + Number(row.rowTotal), 0));
console.log(JSON.stringify({ fixture: '7 periods, 14 rows, 80–120ms upstream delay', elapsedMs, upstreamCalls: calls.length, peak }));
assert.equal(peak, 2, 'period reads overlap, with a maximum of two in flight per summary');
assert.equal(active, 0);

// The second call fails first in wall-clock time. No partial money or later batches escape.
calls.length = 0; audits.length = 0; failPeriod = '2026-07-01';
const failed = await request();
assert.equal(failed.status, 403);
assert.deepEqual(await failed.json(), { error: 'Not found', code: 'forbidden' });
assert.equal(calls.length, 2);
assert.equal(active, 0, 'both in-flight requests finish before reporting the failure');
assert.deepEqual(audits, ['portal.invoice_summary.failed']);

failPeriod = ''; missing = true;
const incomplete = await request();
assert.equal(incomplete.status, 502);
assert.equal((await incomplete.json() as any).code, 'billing_summary_contract_mismatch');
missing = false;

// A selected client and a later refresh use their own fresh canonical answer.
inputRows = rows.filter(row => row.clientId === 7); calls.length = 0;
const selected = await request('Bearer second-user', '&clientId=7');
assert.equal(selected.status, 200);
assert.ok(calls.every(call => call.auth === 'Bearer second-user' && call.query.clientIds.join() === '7'));
assert.equal((await selected.json() as any).data.length, 7);

inputRows = []; calls.length = 0;
assert.equal((await request()).status, 200);
assert.equal(calls.length, 0);
assert.equal((await request('')).status, 401);
scope.canViewFinancials = false;
assert.deepEqual(await (await request()).json(), { data: [], totals: null, billingVisible: false });
assert.equal(calls.length, 0, 'denied and empty scopes do not start upstream work');
console.log('PASS billing summary scheduling, exact period/client totals, freshness, scope, and fail-closed responses');

import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';
setupTestEnv();
const { sql } = await import('../../src/db/client');
const { portalInvoicePeriodSummary } = await import('../../src/lib/client-portal/read-models/invoice-details');

// Disposable database only. Verify the owner, not a second JS grouping formula.
try {
  const [client, other] = await sql`insert into clients (name) values ('Monthly fixture'), ('Other tenant') returning id`;
  assert.ok(client && other);
  const scope = { userId: 'monthly-fixture', clientIds: [client.id], storeIds: [], isGlobal: false,
    isRestricted: true, permissions: [], canViewFinancials: true, canViewCredentials: false };
  await sql`insert into billing_line_items (client_id, ship_date, billing_effective_date, line_type, description, unit_cost, total_cost)
    values (${client.id}, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'pick_pack', 'first half', 2.5, 2.5),
      (${client.id}, '2026-09-30T23:59:59.999Z', '2026-09-30T23:59:59.999Z', 'pick_pack', 'second half', 2.5, 2.5),
      (${client.id}, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 'pick_pack', 'next month', 2.5, 2.5),
      (${other.id}, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z', 'pick_pack', 'other tenant', 2.5, 2.5)`;
  const range = { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-10-01T00:00:00Z' };
  const monthly = [{ clientId: client.id, clientName: 'Monthly fixture', periodStart: '2026-09-01', periodEnd: '2026-09-30' }];
  assert.deepEqual(await portalInvoicePeriodSummary(scope, range), monthly, 'omitted granularity groups both halves once');
  assert.deepEqual(await portalInvoicePeriodSummary(scope, { ...range, granularity: 'month' }), monthly);
  const halves = await portalInvoicePeriodSummary(scope, { ...range, granularity: 'half' });
  assert.deepEqual(halves.map(row => [row.periodStart, row.periodEnd]), [
    ['2026-09-16', '2026-09-30'], ['2026-09-01', '2026-09-15'],
  ], 'explicit half-month clients remain compatible');
  assert.deepEqual(await portalInvoicePeriodSummary(scope, { ...range, clientId: other.id }), [], 'explicit filter cannot widen tenant scope');
  assert.deepEqual(await portalInvoicePeriodSummary(scope, {
    dateFrom: '2026-10-01T00:00:00Z', dateTo: '2026-10-02T00:00:00Z',
  }), [{ ...monthly[0], periodStart: '2026-10-01', periodEnd: '2026-10-31' }], 'next-month boundary is exclusive');
  const upstreamRanges: Array<{ dateFrom: string; dateTo: string }> = [];
  const route = loadFixtureModule('src/routes/client-portal/invoices.ts', {
    '../../lib/client-portal/audit': { recordPortalAudit: async () => {} },
    '../../lib/client-portal/prepship-invoice-totals-proxy': {
      fetchCanonicalInvoiceTotals: async (_authorization: string, input: { dateFrom: string; dateTo: string }) => {
        upstreamRanges.push(input);
        return { ok: true, byClient: new Map([[client.id, { orderCount: 1,
          pickPackTotal: 2.5, additionalTotal: 0, packageTotal: 0, shippingTotal: 0,
          customsDutiesTotal: 0, storageTotal: 0, returnPostageTotal: 0,
          returnProcessingTotal: 0, grandTotal: 2.5 }]]) };
      },
    },
  }).default;
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries({ userId: 'monthly-fixture', role: 'client',
      email: 'monthly@example.test', permissions: ['financials:read'], clientIds: [client.id], storeIds: [] })) {
      c.set(key as never, value as never);
    }
    await next();
  });
  app.route('/', route);
  const response = await app.request('/invoice-summary?groupBy=period&dateFrom=2026-09-15&dateTo=2026-09-30',
    { headers: { authorization: 'Bearer fixture-only' } });
  assert.equal(response.status, 200);
  const body = await response.json() as { data: Array<{ periodStart: string; periodEnd: string; rowTotal: string }> };
  assert.equal(body.data.length, 1, 'route defaults to one monthly row');
  assert.equal(body.data[0]?.periodStart, '2026-09-15', 'drill-in/export starts at the applied date');
  assert.equal(body.data[0]?.periodEnd, '2026-09-30', 'drill-in/export ends at the applied date');
  assert.equal(body.data[0]?.rowTotal, '2.5', 'money passes through from canonical owner');
  assert.equal(upstreamRanges[0]?.dateFrom, body.data[0]?.periodStart);
  assert.equal(upstreamRanges[0]?.dateTo, body.data[0]?.periodEnd);
  console.log('PASS monthly default, explicit compatibility, date boundary and tenant scope');
} finally {
  await sql.end();
}

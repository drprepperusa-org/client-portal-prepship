/** Real PostgreSQL query/route parity, offline: no production DB or upstream calls. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import { PgDialect, PgTable } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import * as schema from '../src/db/schema';
import type { ClientPortalScope } from '../src/lib/client-portal/scope';
import { loadFixtureModule } from './lib/load-fixture-module';
import * as keys from '../src/lib/client-portal/billing-summary-canonical-keys';
import * as days from '../src/lib/client-portal/billing-day';

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/billing_identity_fixture';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.SUPABASE_JWT_SECRET = 'fixture';
const { db, sql: networkSql } = await import('../src/db/client');
const owner = await import('../src/lib/client-portal/read-models/invoice-details');
const pg = new PGlite();
const dialect = new PgDialect({ casing: 'snake_case' });
const columnCasing = new CasingCache('snake_case');
const originalExecute = db.execute;

// Frozen pre-optimization SELECT fields (e549f2d). Insert into the real compiled
// query, leaving every binding, predicate, grouping and ORDER BY unchanged.
const oldFields = `,
 count(distinct b.order_id)::text as orders,
 coalesce(sum(case when b.line_type in ('pick_pack','pickpack') then b.total_cost else 0 end),0)::text as pickpack_total,
 coalesce(sum(case when b.line_type in ('additional_unit','additional') then b.total_cost else 0 end),0)::text as additional_total,
 coalesce(sum(case when b.line_type in ('package_cost','package') then b.total_cost else 0 end),0)::text as package_total,
 coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end),0)::text as shipping_total,
 coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end),0)::text as storage_total,
 coalesce(sum(case when lower(coalesce(b.line_type,'')) in ('return_postage','return_label') then b.total_cost else 0 end),0)::text as returnpostage_total,
 coalesce(sum(case when lower(coalesce(b.line_type,'')) in ('return_processing_fee','return_processing') then b.total_cost else 0 end),0)::text as returnprocessing_total,
 coalesce(sum(b.total_cost),0)::text as row_total
`;
let baseline = false, failDb = false;
let lastQuery = { sql: '', params: [] as unknown[] };
Object.assign(db, { execute: async (query: SQL) => {
  if (failDb) throw new Error('fixture database failure');
  const compiled = dialect.sqlToQuery(query);
  assert.match(compiled.sql, /from billing_line_items b/);
  const projection = compiled.sql.split('from billing_line_items b')[0]!;
  assert.doesNotMatch(projection, /count\(|sum\(/i, 'identity SELECT does not calculate discarded aggregates');
  lastQuery = { sql: compiled.sql, params: compiled.params };
  const statement = baseline ? compiled.sql.replace('from billing_line_items b', `${oldFields}from billing_line_items b`) : compiled.sql;
  return (await pg.query(statement, compiled.params)).rows;
} });

const globalScope: ClientPortalScope = { userId: 'fixture', clientIds: [], storeIds: [], isGlobal: true,
  isRestricted: false, permissions: [], canViewFinancials: true, canViewCredentials: false };
const range = { dateFrom: '2026-06-21T00:00:00.000Z', dateTo: '2026-09-19T00:00:00.000Z' };
let currentScope = globalScope, missing = false, upstreamDenied = false;
const upstreamCalls: unknown[] = [];
const route = loadFixtureModule('src/routes/client-portal/invoices.ts', {
  '../../db/client': { db }, '../../db/schema/clients': { clients: schema.clients },
  '../../lib/client-portal/audit': { recordPortalAudit: async () => {} },
  '../../lib/client-portal/billing-day': days,
  '../../lib/client-portal/scope': { isClientPortalScope: (s: unknown) => s === currentScope },
  '../../lib/client-portal/predicates': {}, '../../lib/client-portal/invoice-html': {},
  '../../lib/client-portal/billing-summary-canonical-keys': keys,
  '../../lib/client-portal/read-models/invoice-details': owner,
  '../../lib/client-portal/read-models/canonical-invoice-events': {},
  '../../lib/client-portal/query-params': { scopeOrResponse: () => currentScope,
    requestedClientId: (c: any) => c.req.query('clientId') ? Number(c.req.query('clientId')) : undefined },
  '../../lib/client-portal/prepship-invoice-totals-proxy': {
    fetchCanonicalInvoiceTotals: async (auth: string, q: any, requestId: string) => {
      assert.equal(auth, 'Bearer offline'); assert.equal(requestId, 'identity-fixture');
      upstreamCalls.push(q);
      if (upstreamDenied) return { ok: false, status: 403, error: 'Not found', code: 'forbidden' };
      return { ok: true, byClient: new Map(q.clientIds.filter((id: number) => !missing || id !== 1).map((id: number) => {
        const amount = id * 100 + Number(q.dateFrom.slice(8));
        return [id, { orderCount: id, pickPackTotal: amount, additionalTotal: 2, packageTotal: 3,
          shippingTotal: 4, storageTotal: 5, returnPostageTotal: 6, returnProcessingTotal: 7, grandTotal: amount + 27 }];
      })) };
    },
  },
}).default;
const app = new Hono().route('/', route);
const request = (query = '', auth = true) => app.request(
  `/invoice-summary?dateFrom=2026-06-21&dateTo=2026-09-18${query}`,
  { headers: { ...(auth ? { authorization: 'Bearer offline' } : {}), 'x-request-id': 'identity-fixture' } },
);

try {
  await pg.exec("set timezone to 'UTC'");
  for (const table of Object.values(schema)) {
    if (!(table instanceof PgTable)) continue;
    const columns = Object.values(getTableColumns(table)).map(c => `"${columnCasing.getColumnCasing(c)}" ${c.getSQLType()}`);
    await pg.exec(`create table if not exists "${getTableName(table)}" (${columns.join(',')})`);
  }
  await pg.exec(`
    insert into clients(id,name,active) values (1,'One',true),(2,'Two',true),(3,'Inactive',false),
      (4,'Zero only',true),(5,'Unvalidated return only',true),(6,'No lines',true),(7,'Validated return only',true),
      (8,'Exclusive end',true),(9,'Before start',true),(10,'Effective date inside',true),(11,'Effective date outside',true);
    insert into orders(id,client_id,store_id) select g,case when g%3=0 then 2 else 1 end,
      case when g%3=0 then 102 else 101 end from generate_series(1,30000) g;
    insert into billing_line_items(id,client_id,order_id,line_type,total_cost,ship_date,billing_effective_date)
      select g,case when g%3=0 then 2 else 1 end,g,
        (array['pick_pack','additional_unit','package_cost','shipping','storage','return_processing','return'])[1+g%7],
        case when g%3=0 then 5 else 1 end,'2026-06-01'::timestamptz + (g%100)*interval '1 day',
        case when g%13=0 then '2026-07-01'::timestamptz else null end from generate_series(1,30000) g;
    insert into billing_line_items(id,client_id,line_type,total_cost,ship_date) values
      (40001,3,'pick_pack',999,'2026-07-01'),(40002,4,'storage',0,'2026-07-01'),
      (40003,5,'RETURN_LABEL',999,'2026-07-01'),(40004,1,'storage',7,'2026-09-19');
    insert into shipments(id,selected_rate_json) values (900,'{"selectedRateCost":4,"cShippingRateAmount":5,
      "shippingMarginAmount":1,"shippingMarginPct":25,"customerRateSource":"realized_customer_shipping_rate",
      "rateCostSource":"label_final_cost","customerShippingMoneyPolicyVersion":"ps-437-v1"}');
    insert into returns(id,return_shipment_id,return_customer_shipping_rate) values(900,900,5);
    insert into billing_line_items(id,client_id,shipment_id,line_type,total_cost,ship_date)
      values(40005,7,900,'RETURN_LABEL',5,'2026-07-01');
    insert into billing_line_items(id,client_id,line_type,total_cost,ship_date,billing_effective_date) values
      (40006,8,'storage',1,'2026-09-19',null),(40007,9,'storage',1,'2026-06-20T23:59:59.999Z',null),
      (40008,10,'storage',1,'2026-06-20','2026-06-21'),(40009,11,'storage',1,'2026-09-18','2026-09-19');
    analyze;
  `);
  const scopes = [globalScope,
    { ...globalScope, isGlobal: false, isRestricted: true, clientIds: [1] },
    { ...globalScope, isGlobal: false, isRestricted: true, storeIds: [102] },
    { ...globalScope, isGlobal: false, isRestricted: true, clientIds: [1], storeIds: [102] },
    { ...globalScope, isGlobal: false, isRestricted: true },
  ];
  let comparisons = 0;
  for (const timezone of ['UTC', 'America/Los_Angeles']) {
    await pg.exec(`set timezone to '${timezone}'`);
    for (const scope of scopes) for (const clientId of [undefined, 1, 2, 999]) {
      for (const granularity of ['plain', 'half', 'month'] as const) {
        const read = () => granularity === 'plain' ? owner.portalInvoiceSummary(scope, { ...range, clientId })
          : owner.portalInvoicePeriodSummary(scope, { ...range, clientId, granularity });
        baseline = true; const before = await read();
        baseline = false; const after = await read();
        assert.deepEqual(after, before, 'same complete identities and order as the old aggregate SELECT');
        for (const row of after) assert.deepEqual(Object.keys(row).sort(), granularity === 'plain'
          ? ['clientId','clientName'] : ['clientId','clientName','periodEnd','periodStart']);
        if (scope.isRestricted && !scope.clientIds.length && !scope.storeIds.length) assert.equal(after.length, 0);
        if (!scope.isRestricted && clientId === undefined) {
          assert.deepEqual(new Set(after.map(x=>x.clientId)), new Set([1,2,4,7,10]));
          if (granularity !== 'plain') assert.ok(after.some(row => 'periodStart' in row
            && row.clientId === 10 && row.periodStart === (granularity === 'half' ? '2026-06-16' : '2026-06-01')));
        }
        if (scope.isRestricted && scope.storeIds.length && !scope.clientIds.length && clientId === undefined)
          assert.deepEqual(new Set(after.map(x=>x.clientId)), new Set([2]));
        if (scope.isRestricted && scope.clientIds.length && !scope.storeIds.length && clientId === 2) assert.equal(after.length, 0);
        comparisons++;
      }
    }
  }
  await pg.exec("set timezone to 'UTC'");
  for (const q of ['', '&groupBy=period', '&groupBy=period&granularity=month', '&groupBy=period&clientId=1', '&clientId=999']) {
    baseline = true; upstreamCalls.length = 0;
    const before = await request(q); const beforeBody = await before.json(); const beforeCalls = [...upstreamCalls];
    baseline = false; upstreamCalls.length = 0;
    const after = await request(q);
    assert.equal(before.status, 200); assert.equal(after.status, 200);
    assert.deepEqual(await after.json(), beforeBody, 'real route rows/footer remain identical with canonical fixture totals');
    assert.deepEqual(upstreamCalls, beforeCalls, 'same period clamps, client sets and upstream work');
  }
  assert.equal((await request('', false)).status, 401);
  missing = true; assert.equal((await request('&groupBy=period')).status, 502); missing = false;
  upstreamDenied = true; assert.equal((await request('&groupBy=period')).status, 403); upstreamDenied = false;
  currentScope = { ...globalScope, canViewFinancials: false }; upstreamCalls.length = 0;
  assert.deepEqual(await (await request()).json(), { data: [], totals: null, billingVisible: false });
  assert.equal(upstreamCalls.length, 0); currentScope = globalScope;
  failDb = true; await assert.rejects(owner.portalInvoiceSummary(globalScope, range), /fixture database failure/); failDb = false;

  // Alternating warm queries; timings are diagnostic, never a flaky acceptance threshold.
  await owner.portalInvoicePeriodSummary(globalScope, { ...range, granularity: 'half' });
  const query = lastQuery;
  const oldSql = query.sql.replace('from billing_line_items b', `${oldFields}from billing_line_items b`);
  const elapsed = { before: [] as number[], after: [] as number[] };
  for (let i=0; i<12; i++) for (const key of (i%2 ? ['after','before'] : ['before','after']) as Array<keyof typeof elapsed>) {
    const start = performance.now(); await pg.query(key === 'before' ? oldSql : query.sql, query.params);
    if (i>=2) elapsed[key].push(performance.now()-start);
  }
  const median = (v: number[]) => { const a=[...v].sort((a,b)=>a-b); return Number(((a[4]!+a[5]!)/2).toFixed(2)); };
  console.log(JSON.stringify({ fixtureRows:30009, identityComparisons:comparisons,
    warmQuerySamples:10, beforeMedianMs:median(elapsed.before), afterMedianMs:median(elapsed.after),
    removedAggregates:['distinct order count','7 category sums'], retainedAggregate:'sum(total_cost) for order only' }));
  console.log('PASS real SQL identity/order/scope/UTC/return safety, canonical route parity and fail-closed checks');
} finally {
  db.execute = originalExecute;
  await pg.close(); await networkSql.end();
}

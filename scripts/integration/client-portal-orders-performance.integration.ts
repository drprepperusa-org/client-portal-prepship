/** Actual Orders owner and SQL on disposable PostgreSQL; no production/network reads. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';

setupTestEnv();
const { db, sql } = await import('../../src/db/client');
const { replacementsSchemaReady } = await import('../../src/lib/client-portal/replacements-schema-readiness');
let countReads = 0, active = 0, peak = 0, failNext = false, delayMs = 40;
// Preserve the real query builder, SQL, bound parameters and execution. Delay only the
// I/O boundary for the reproducible round-trip scenario; native runs set delayMs = 0.
function measured(query: any): any {
  return new Proxy(query, {
    get(target, property) {
      if (property === 'then') return (resolve: any, reject: any) => {
        const isCount = /^select count\(\*\)::int/.test(target.toSQL().sql);
        const shouldFail = isCount && failNext;
        if (isCount) { countReads++; failNext = false; }
        active++; peak = Math.max(peak, active);
        return (async () => {
          try {
            if (delayMs) await new Promise(done => setTimeout(done, delayMs));
            if (shouldFail) throw new Error('fixture count unavailable');
            return await target.execute();
          } finally { active--; }
        })().then(resolve, reject);
      };
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const result = value.apply(target, args);
        return ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset'].includes(String(property))
          ? measured(result) : result;
      };
    },
  });
}
const owner = loadFixtureModule('src/lib/client-portal/read-models/orders.ts', {
  '../../../db/client': { db: { select: (...args: any[]) => measured((db.select as any)(...args)) } },
});
const scope = (userId: string, clientIds: number[], storeIds: number[] = []) => ({
  userId, email: 'fixture@example.test', role: 'client_user', permissions: [],
  clientIds, storeIds, isGlobal: false, isRestricted: true,
  canViewFinancials: false, canViewCredentials: false,
});
const opts = { page: 1, pageSize: 25, status: 'awaiting_shipment', search: '' };
const samples: Record<string, unknown>[] = [];
try {
  await sql`truncate orders, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, active, store_ids)
    values ('Performance A', true, array[7701]), ('Performance B', true, array[7702]) returning id`;
  assert.ok(a && b, 'both fixture clients were created');
  await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, order_total, items)
    select ${a.id}, 7701, 'ORD-' || g, case when g <= 600 then 'awaiting_shipment' else 'shipped' end,
      '2026-09-01'::timestamptz + g * interval '1 minute', 10, '[]'::jsonb from generate_series(1, 1000) g`;
  await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, order_total, items)
    values (${b.id}, 7702, 'OTHER-1', 'awaiting_shipment', '2026-09-01', 10, '[]'::jsonb)`;
  await sql`analyze orders`;
  await replacementsSchemaReady();
  const caller = scope('A', [a.id]);
  const start = performance.now();
  const [page, badge] = await Promise.all([
    owner.listPortalOrders(caller, opts), owner.awaitingActiveOrderCount(caller, {}),
  ]);
  samples.push({ scenario: 'list + badge, 40ms per DB read', elapsedMs: Math.round(performance.now() - start), countReads, peak });
  assert.equal(page.pagination.total, 600);
  assert.equal(badge, 600);
  assert.equal(page.data.length, 25);
  assert.equal(active, 0);
  console.log(JSON.stringify(samples[0]));
  assert.equal(countReads, 1, 'simultaneous list and badge execute one count');
  assert.ok(peak <= 2, 'a list + matching badge never needs more than two active reads');

  // A later read MUST see the committed change: completed counts never remain cached.
  await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, items)
    values (${a.id}, 7701, 'NEW', 'awaiting_shipment', '2026-09-02', '[]'::jsonb)`;
  assert.equal(await owner.awaitingActiveOrderCount(caller, {}), 601);
  assert.equal(countReads, 2);

  countReads = 0;
  const [searchPage, plainBadge] = await Promise.all([
    owner.listPortalOrders(caller, { ...opts, search: 'NEW' }), owner.awaitingActiveOrderCount(caller, {}),
  ]);
  assert.equal(searchPage.pagination.total, 1);
  assert.equal(plainBadge, 601);
  assert.equal(countReads, 1, 'only the unfiltered badge needs a separate count');
  const searchOpts = { ...opts, search: 'ORD-', pageSize: 10 };
  for (const page of [1, 2, 60, 61]) {
    const res = await owner.listPortalOrders(caller, { ...searchOpts, page });
    assert.equal(res.pagination.total, 600);
    assert.equal(res.data.length, page > 60 ? 0 : 10);
  }
  assert.equal((await owner.listPortalOrders(caller, { ...opts, search: 'OTHER-1' })).pagination.total, 0);
  assert.equal((await owner.listPortalOrders(scope('B', [b.id]), { ...opts, search: 'OTHER-1' })).pagination.total, 1);
  assert.equal((await owner.listPortalOrders(scope('none', []), searchOpts)).pagination.total, 0);
  const [fixtureOrder] = await sql`select id from orders where order_number = 'ORD-1'`;
  await sql`insert into order_items(order_id,line_index,sku,quantity,unit_price,line_total,order_status)
    values (${fixtureOrder!.id}, 2, 'ITEM-B', 2, 1, 2, 'awaiting_shipment'),
           (${fixtureOrder!.id}, 1, 'ITEM-A', 1, 1, 1, 'awaiting_shipment')`;
  const itemSearch = await owner.listPortalOrders(caller, { ...opts, search: 'ITEM-B' });
  assert.equal(itemSearch.pagination.total, 1);
  assert.deepEqual(itemSearch.data[0].items.map((i: any) => i.sku), ['ITEM-A', 'ITEM-B']);
  assert.equal(itemSearch.data[0].orderedUnits, 3);
  assert.deepEqual((await owner.getPortalOrder(caller, fixtureOrder!.id)).items, itemSearch.data[0].items);
  assert.equal(await owner.getPortalOrder(scope('B', [b.id]), fixtureOrder!.id), null);

  // Large provider payloads and internal quotes never belong in the page's DB
  // projection. Legacy address, tax, promo, and tracking inputs still do.
  await sql`update orders set raw = jsonb_build_object(
      'shipTo', jsonb_build_object('street1','Legacy street','country','CA'),
      'taxAmount', 1, 'ignoredPayload', repeat('x', 100000)),
    raw_source_payload = jsonb_build_object('provider', repeat('x', 100000))
    where id = ${fixtureOrder!.id}`;
  await sql`insert into order_overrides(order_id,tracking_number,best_rate_json)
    values (${fixtureOrder!.id}, 'LEGACY-TRACK', '{"internal":true}')`;
  for (const canViewFinancials of [false, true]) {
    const identity = { ...caller, canViewFinancials };
    const list = await owner.listPortalOrders(identity, { ...opts, search: 'ITEM-B' });
    const detail = await owner.getPortalOrder(identity, fixtureOrder!.id);
    assert.deepEqual(list.data[0], detail);
    assert.equal(detail.shipToLine1, 'Legacy street');
    assert.equal(detail.shipToCountry, 'CA');
    assert.equal(detail.displayTrackingNumber, 'LEGACY-TRACK');
    assert.equal('chargeSummary' in detail, canViewFinancials);
    if (canViewFinancials) assert(detail.chargeSummary.some((r: any) => r.kind === 'tax' && r.amount === 1));
  }

  countReads = 0;
  const distinct = await Promise.all([
    owner.awaitingActiveOrderCount(caller, {}),
    owner.awaitingActiveOrderCount(scope('B', [b.id]), {}),
    owner.awaitingActiveOrderCount(scope('A', [b.id]), {}),
    owner.awaitingActiveOrderCount(scope('other-user', [a.id]), {}),
    owner.awaitingActiveOrderCount(scope('A', [], [7702]), {}),
    owner.awaitingActiveOrderCount(caller, { clientId: b.id }),
    owner.awaitingActiveOrderCount(caller, { storeId: 7702 }),
  ]);
  assert.deepEqual(distinct, [601, 1, 1, 601, 1, 0, 0]);
  assert.equal(countReads, 7, 'user, client/store scope and explicit filters stay separate');

  countReads = 0; failNext = true;
  const failures = await Promise.allSettled([
    owner.awaitingActiveOrderCount(caller, {}), owner.awaitingActiveOrderCount(caller, {}),
  ]);
  assert.ok(failures.every(result => result.status === 'rejected'));
  assert.equal(countReads, 1);
  assert.equal(await owner.awaitingActiveOrderCount(caller, {}), 601, 'failed reads are evicted and retry normally');
  assert.equal(countReads, 2);

  const sorted = await owner.listPortalOrders(caller, { ...opts, page: 2, pageSize: 10, sortBy: 'order', sortDir: 'asc' });
  assert.equal(sorted.pagination.total, 601);
  assert.equal(sorted.pagination.totalPages, 61);
  assert.equal(sorted.data.length, 10);
  assert.equal((await owner.listPortalOrders(caller, { ...opts, page: 10000 })).data.length, 0);
  assert.equal((await owner.listPortalOrders(caller, { ...opts, status: 'shipped' })).pagination.total, 400);

  delayMs = 0;
  const timings: number[] = []; countReads = 0; peak = 0;
  for (let i = 0; i < 20; i++) {
    const before = performance.now();
    await Promise.all([owner.listPortalOrders(caller, opts), owner.awaitingActiveOrderCount(caller, {})]);
    timings.push(performance.now() - before);
  }
  timings.sort((x, y) => x - y);
  assert.equal(countReads, 20, 'native overlapping requests execute one count per pair');
  assert.equal(active, 0);
  console.log(JSON.stringify({ scenario: 'native PostgreSQL, 20 list + badge runs', countReads, peak,
    medianMs: Math.round(timings[10]!), p95Ms: Math.round(timings[18]!) }));
  console.log('PASS Orders SQL deduplication, count freshness, failures, filters, scope, and pagination');
} finally { await sql.end({ timeout: 5 }); }

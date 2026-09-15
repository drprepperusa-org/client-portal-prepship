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
  assert.equal(countReads, 2, 'search result totals cannot satisfy an unfiltered badge');

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

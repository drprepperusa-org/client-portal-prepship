import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadFixtureModule } from './lib/load-fixture-module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iterations = process.env.SHARED_DB_PARITY_ONLY === "1" ? 0 : 50;
const BASE = '164f5520b04c78241ae6edf529d58741c9258b76';
const beforeSource = (file: string) => execFileSync('git', ['show', `${BASE}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 4000000 });
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

/** Called by the sibling PrepShip native harness against its same disposable DB. */
export async function verifyPortalSharedDatabase(seed: any, companion: {
  fixture: { root: string; clientId: number; range: unknown; orderIds: Record<string, number> };
  baseline: () => Promise<unknown>; candidate: () => Promise<unknown>;
  billing: (url: string) => Promise<Response>;
  order: (dataset: string, kind: string, version: 'baseline' | 'candidate') => Promise<unknown>;
}) {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.pathname, '/ps520_invoice_routes');
  const { db, sql } = await import('../src/db/client');
  // Only local fixture provisioning. No migration or deployed schema change.
  await seed.unsafe(
    'alter table orders add column if not exists selling_fee numeric, add column if not exists selling_fee_breakdown jsonb, add column if not exists selling_fee_synced_at timestamptz, add column if not exists selling_fee_source text',
  );
  let queries = 0, active = 0, peak = 0, operationMs = 0;
  const measuredDb = { execute: async (statement: any) => {
    queries++; active++; peak = Math.max(peak, active); const start = performance.now();
    try { return await db.execute(statement); }
    finally { active--; operationMs += performance.now() - start; }
  } };
  const readBoundary = { '../db/client': { db: measuredDb } };
  const ownerPath = path.join(root, 'src/routes/analysis.ts');
  const before = loadFixtureModule(ownerPath, readBoundary, beforeSource('src/routes/analysis.ts')).getSkuBreakdownFromOrderItems;
  const after = loadFixtureModule(ownerPath, readBoundary).getSkuBreakdownFromOrderItems;
  const dashboardPath = 'src/lib/client-portal/read-models/dashboard.ts';
  const dashboardBefore = loadFixtureModule(path.join(root, dashboardPath), {
    '../../../routes/analysis': { getSkuBreakdownFromOrderItems: before },
  }, beforeSource(dashboardPath)).getClientPortalDashboardSummary;
  const dashboardAfter = loadFixtureModule(path.join(root, dashboardPath), {
    '../../../routes/analysis': { getSkuBreakdownFromOrderItems: after },
  }).getClientPortalDashboardSummary;
  const [client] = await seed`insert into clients(name, active, is_test, store_ids) values ('shared portal analytics', true, false, array[509998]) returning id`;
  const clientId = Number(client.id);
  const q = { clientId, dateFrom: '2026-05-01', dateTo: '2026-05-31T23:59:59Z', limit: 2000, includeCancelled: false,
    hideTestOrders: false, shippingBasis: 'customer_billed', includeOrderCombinations: false, canViewFinancials: true };
  const results: any[] = [];
  const billingResults: any[] = [];
  const dashboardResults: any[] = [];
  const companionResults: any[] = [];
  const rechecks: any[] = [];
  const originalFetch = globalThis.fetch;
  let upstreamBytes = 0, upstreamCalls = 0;
  // Execute the actual producer route and actual consumer boundary, offline.
  const proxy = loadFixtureModule(path.join(root, 'src/lib/client-portal/prepship-billing-details-proxy.ts'), {
    '../env.js': { env: { PREPSHIP_API_URL: 'http://127.0.0.1/fixture' } },
    '../env': { env: { PREPSHIP_API_URL: 'http://127.0.0.1/fixture' } },
  });
  globalThis.fetch = async (url: any) => {
    const parsed = new URL(String(url)); assert.equal(parsed.hostname, '127.0.0.1');
    upstreamCalls++;
    const response = await companion.billing(parsed.pathname.replace('/fixture', '') + parsed.search);
    const text = await response.text(); upstreamBytes += Buffer.byteLength(text);
    return new Response(text, { status: response.status, headers: response.headers });
  };
  const billingPath = 'src/lib/client-portal/read-models/canonical-invoice-events.ts';
  const billingBoundary = { '../prepship-billing-details-proxy.js': proxy };
  const billingBefore = loadFixtureModule(path.join(root, billingPath), billingBoundary, beforeSource(billingPath)).portalCanonicalInvoiceEvents;
  const billingAfter = loadFixtureModule(path.join(root, billingPath), billingBoundary).portalCanonicalInvoiceEvents;
  try {
    for (const dataset of ['small', 'large']) {
      const n = dataset === 'small' ? 30 : 2970;
      await seed`insert into orders(client_id, store_id, order_number, order_date, order_status, items)
        select ${clientId}, 509998, 'portal-' || ${dataset} || g, '2026-05-15'::timestamptz, 'awaiting_shipment',
          jsonb_build_array(jsonb_build_object('sku', 'SKU-' || (g % 15), 'name', 'Fixture item', 'quantity', 2, 'unitPrice', 3.5))
        from generate_series(1, ${n}) g`;
      await seed.unsafe('analyze orders');
      await seed.unsafe('analyze order_items');
      await seed`insert into billing_line_items(client_id, order_id, order_number, ship_date, line_type, description, qty, unit_cost, total_cost)
        select ${clientId}, id, order_number, '2026-05-15'::timestamptz, 'pick_pack', 'fixture picking', 1, 2.5, 2.5
        from orders o where o.client_id = ${clientId} and not exists(select 1 from billing_line_items b where b.order_id = o.id)`;
      await seed.unsafe('analyze billing_line_items');
      const billingInput = { clientId, dateFrom: '2026-05-01', dateTo: '2026-05-31', page: 1, pageSize: 100, sortBy: 'grandTotal', sortDir: 'desc' };
      if (process.env.SHARED_DB_EXTENDED === '1') {
        if (process.env.SHARED_DB_PAGES === '1') {
          // Shared fixture also needs Portal-owned 0017 tracking metadata used by PS-486.
          await seed.unsafe('alter table shipments add column if not exists tracking_status text');
          // Exercise the real assignee filter with an assigned local operator identity.
          await seed`update orders set assigned_to_user_id = case
            when ${dataset} = 'large' or order_number like 'order-measure-small%' then 'offline-page-user'
            else 'offline-companion-user' end where client_id = ${companion.fixture.clientId}`;
          await seed.unsafe(`create table if not exists client_portal_audit_logs (
            id serial primary key, event text not null, actor_user_id text, actor_email text,
            client_ids integer[] not null default '{}', store_ids integer[] not null default '{}',
            metadata jsonb not null default '{}', created_at timestamptz not null default now())`);
          await seed`insert into inventory(client_id, sku, name, active, reorder_level)
            select ${clientId}, 'PAGE-SKU-' || g, 'Local inventory fixture ' || g, true, 5 from generate_series(1, ${dataset === 'small' ? 30 : 3000}) g
            on conflict (client_id, sku) do nothing`;
          await seed`insert into inventory_ledger(inventory_id, client_id, sku, type, qty, source_entity, source_id, idempotency_key, effective_at, created_by)
            select id, client_id, sku, 'receive', 10, 'shared_db_fixture', 'page-' || id, 'shared-db-page-' || id, '2026-06-01'::timestamptz, 'offline-fixture' from inventory i where i.client_id = ${clientId}
            and not exists(select 1 from inventory_ledger l where l.inventory_id = i.id)`;
        }
        const { runExtendedMeasurements } = await import(pathToFileURL(path.join(companion.fixture.root, 'scripts/shared-db-extended.ts')).href);
        await runExtendedMeasurements({ prepship: companion.fixture,
          portal: { root, clientId, analysisInput: q, billingInput }, dataset });
      }
      const billingOld = await billingBefore({}, 'Bearer offline', billingInput);
      const billingNew = await billingAfter({}, 'Bearer offline', billingInput);
      assert.equal(billingNew.ok, true, JSON.stringify(billingNew));
      assert.deepEqual(billingNew, billingOld, 'real producer and portal consumer page parity including item text and whole-range totals');
      const [changedOrder] = await seed`select id, order_number from orders where client_id = ${clientId} order by id limit 1`;
      const [adjustment] = await seed`insert into billing_line_items(client_id, order_id, order_number, ship_date, line_type, description, qty, unit_cost, total_cost)
        values (${clientId}, ${changedOrder.id}, ${changedOrder.order_number}, '2026-05-15'::timestamptz, 'adjustment', 'fixture concurrent refresh', 1, 1, 1) returning id`;
      try {
        const changedPage = await billingAfter({}, 'Bearer offline', billingInput);
        assert.deepEqual(changedPage, await billingBefore({}, 'Bearer offline', billingInput), 'refresh after concurrent data change uses the current canonical ordering and totals');
        assert.notDeepEqual(changedPage, billingNew, 'the refreshed page must reflect the changed charge');
      } finally { await seed`delete from billing_line_items where id = ${adjustment.id}`; }
      assert.deepEqual(await billingAfter({}, 'Bearer offline', billingInput), billingNew, 'fixture restored before measurements');
      for (const concurrency of [1, 4]) for (const [version, run] of [['baseline', billingBefore], ['candidate', billingAfter]] as const) {
        const times: number[] = [], companionSamples: number[] = [];
        const coldStart = performance.now(); await run({}, 'Bearer offline', billingInput); const coldMs = performance.now() - coldStart;
        upstreamBytes = 0; upstreamCalls = 0;
        for (let i = 0; i < iterations; i++) await Promise.all([...Array.from({ length: concurrency }, async () => {
          const start = performance.now(); const value = await run({}, 'Bearer offline', billingInput);
          assert.equal(value.ok, true); times.push(performance.now() - start);
        }), (async () => { const start = performance.now(); await companion.baseline(); companionSamples.push(performance.now() - start); })()]);
        times.sort((a,b)=>a-b);
        companionSamples.sort((a,b)=>a-b);
        billingResults.push({ phase: 3, dataset, concurrency, version, runs: times.length, coldMs,
          medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * .95) - 1],
          upstreamBytesPerRead: upstreamBytes / times.length, upstreamRequestsPerRead: upstreamCalls / times.length,
          companionMedianMs: companionSamples[25], companionP95Ms: companionSamples[47],
          errors: 0 });
      }
      const expected = json(await before(q));
      assert.deepEqual(json(await after(q)), expected, 'Analysis exact DTO parity');
      assert.ok(expected.totalUnits > 0, 'nonempty analytics fixture');
      assert.deepEqual(json(await after({ ...q, canViewFinancials: false })), json(await before({ ...q, canViewFinancials: false })), 'redaction parity');
      assert.deepEqual(json(await after({ ...q, clientIds: [], storeIds: [], scopeRestricted: true })), json(await before({ ...q, clientIds: [], storeIds: [], scopeRestricted: true })), 'empty restricted scope parity');
      if (process.env.SHARED_DB_RECHECK === '1' && dataset === 'small') {
        // Paired ordering removes the baseline-first / candidate-second timing bias.
        const cases = [
          { name: 'Billing pagination', phase: 3, callers: 1,
            primary: (version: string) => (version === 'baseline' ? billingBefore : billingAfter)({}, 'Bearer offline', billingInput),
            other: () => companion.baseline() },
          { name: 'Orders full', phase: 5, callers: 4,
            primary: (version: 'baseline' | 'candidate') => companion.order('small', 'full', version),
            other: () => before(q) },
        ];
        for (const testCase of cases) {
          for (const version of ['baseline', 'candidate'] as const) for (let warm = 0; warm < 5; warm++) {
            await Promise.all([testCase.primary(version), testCase.other()]);
          }
          for (let round = 1; round <= 3; round++) {
            const samples = { baseline: [] as number[], candidate: [] as number[] };
            const primarySamples = { baseline: [] as number[], candidate: [] as number[] };
            for (let i = 0; i < 50; i++) {
              const versions = i % 2 ? ['candidate', 'baseline'] as const : ['baseline', 'candidate'] as const;
              for (const version of versions) await Promise.all([
                ...Array.from({ length: testCase.callers }, async () => {
                  const start = performance.now(); await testCase.primary(version); primarySamples[version].push(performance.now() - start);
                }),
                (async () => { const start = performance.now(); await testCase.other(); samples[version].push(performance.now() - start); })(),
              ]);
            }
            for (const version of ['baseline', 'candidate'] as const) {
              samples[version].sort((a,b)=>a-b); primarySamples[version].sort((a,b)=>a-b);
              rechecks.push({ phase: testCase.phase, workflow: testCase.name, dataset, callers: testCase.callers, round, version,
                companionSamplesMs: samples[version], companionP95Ms: samples[version][47],
                medianMs: primarySamples[version][Math.floor(primarySamples[version].length/2)],
                p95Ms: primarySamples[version][Math.ceil(primarySamples[version].length*.95)-1], errors: 0 });
            }
          }
        }
      }
      // Isolate each PrepShip phase while keeping the portal's baseline owner fixed.
      // Small/large here combine 30/3,000 portal orders with 3/200 displayed PrepShip rows.
      for (const workflow of ['margin', 'list', 'detail', 'full']) for (const concurrentUsers of [1, 4]) {
        for (const version of ['baseline', 'candidate'] as const) {
          const samples: number[] = [], portalSamples: number[] = [];
          const primary = () => workflow === 'margin' ? companion[version]() : companion.order(dataset, workflow, version);
          await primary(); await before(q);
          for (let i = 0; i < iterations; i++) await Promise.all([
            ...Array.from({ length: concurrentUsers }, async () => {
              const start = performance.now(); await primary(); samples.push(performance.now() - start);
            }),
            (async () => { const start = performance.now(); await before(q); portalSamples.push(performance.now() - start); })(),
          ]);
          samples.sort((a,b)=>a-b); portalSamples.sort((a,b)=>a-b);
          companionResults.push({ phase: workflow === 'margin' ? 4 : 5, dataset, workflow, concurrentUsers, version,
            runs: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.ceil(samples.length * .95) - 1],
            companionMedianMs: portalSamples[25], companionP95Ms: portalSamples[47], errors: 0 });
        }
      }
      const dashboardInput = {
        scope: { userId: 'offline', email: 'offline@example.test', role: 'admin', permissions: [],
          clientIds: [], storeIds: [], isGlobal: true, isRestricted: false, canViewFinancials: true, canViewCredentials: false },
        clientId, dateFrom: new Date(q.dateFrom), dateTo: new Date(q.dateTo),
      };
      assert.deepEqual(json(await dashboardAfter(dashboardInput)), json(await dashboardBefore(dashboardInput)), 'native full Dashboard DTO parity');
      const redactedDashboard = { ...dashboardInput, scope: { ...dashboardInput.scope, canViewFinancials: false } };
      assert.deepEqual(json(await dashboardAfter(redactedDashboard)), json(await dashboardBefore(redactedDashboard)), 'native Dashboard redaction parity');
      for (const concurrentUsers of [1, 4]) for (const [version, run] of [['baseline', dashboardBefore], ['candidate', dashboardAfter]] as const) {
        const samples: number[] = [], companionSamples: number[] = [];
        const coldStart = performance.now(); await run(dashboardInput); const coldMs = performance.now() - coldStart;
        for (let i = 0; i < iterations; i++) await Promise.all([
          ...Array.from({ length: concurrentUsers }, async () => {
            const start = performance.now(); await run(dashboardInput); samples.push(performance.now() - start);
          }),
          (async () => { const start = performance.now(); await companion.baseline(); companionSamples.push(performance.now() - start); })(),
        ]);
        samples.sort((a,b)=>a-b); companionSamples.sort((a,b)=>a-b);
        dashboardResults.push({ phase: 6, dataset, concurrentUsers, version, runs: samples.length, coldMs,
          medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.ceil(samples.length * .95) - 1],
          companionMedianMs: companionSamples[25], companionP95Ms: companionSamples[47], errors: 0 });
      }
      for (const concurrentUsers of [1, 4]) for (const [version, run] of [['baseline', before], ['candidate', after]] as const) {
        const samples: number[] = [], companionSamples: number[] = []; let bytes = 0;
        const coldStart = performance.now(); await run(q); const coldMs = performance.now() - coldStart;
        queries = 0; peak = 0; operationMs = 0;
        for (let i = 0; i < iterations; i++) {
          await Promise.all([
            ...Array.from({ length: concurrentUsers }, async () => {
              const start = performance.now(), value = await run(q);
              samples.push(performance.now() - start); bytes = Buffer.byteLength(JSON.stringify(value));
            }),
            // Hold the companion app fixed to isolate this phase's effect.
            (async () => { const start = performance.now(); await companion.baseline(); companionSamples.push(performance.now() - start); })(),
          ]);
        }
        samples.sort((a, b) => a - b); companionSamples.sort((a, b) => a - b);
        results.push({ phase: 6, dataset, concurrentUsers, version, runs: samples.length, coldMs, bytes,
          medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.ceil(samples.length * .95) - 1],
          companionMedianMs: companionSamples[25], companionP95Ms: companionSamples[47], databaseQueries: queries,
          databaseOperationMsIncludingWait: operationMs, peakAcrossRequests: peak, outstanding: active, errors: 0 });
        if (version === 'candidate' && concurrentUsers === 1) assert.ok(peak <= 2);
        assert.equal(active, 0);
      }
    }
    mkdirSync(path.join(root, 'reports/shared-db'), { recursive: true });
    if (iterations > 0) writeFileSync(
      path.join(root, 'reports/shared-db/native-analytics-measurements.json'),
      JSON.stringify({
        baseline: BASE, runId: process.env.SHARED_DB_MEASUREMENT_ID, iterations,
        notes: 'Same disposable native PostgreSQL as PrepShip; owner timing, not browser. Companion is Shipping Margin. DB operation duration includes wait. Cold first measured use follows schema/fixture setup.',
        results,
      }, null, 2),
    );
    if (iterations > 0) writeFileSync(
      path.join(root, 'reports/shared-db/native-pagination-measurements.json'),
      JSON.stringify({
        baseline: BASE, runId: process.env.SHARED_DB_MEASUREMENT_ID, iterations,
        notes: 'Actual producer route and consumer owner, shared native database. Both use the prerequisite canonical ID contract; baseline consumer downloads full rows then slices. No reduction in canonical backend assembly claimed.',
        results: billingResults,
      }, null, 2),
    );
    if (iterations > 0) writeFileSync(
      path.join(root, 'reports/shared-db/native-dashboard-measurements.json'),
      JSON.stringify({
        baseline: BASE, runId: process.env.SHARED_DB_MEASUREMENT_ID, iterations,
        notes: 'Full Dashboard owner, same shared native fixture; unchanged companion Shipping Margin. Owner timings, not browser timings.',
        results: dashboardResults,
      }, null, 2),
    );
    if (iterations > 0) writeFileSync(
      path.join(root, 'reports/shared-db/native-companion-measurements.json'),
      JSON.stringify({
        baseline: BASE, runId: process.env.SHARED_DB_MEASUREMENT_ID, iterations,
        notes: 'PrepShip margin and Orders workflows with an unchanged baseline portal Analysis read per batch. Shared native database, 50 iterations; warm owner timings, not browser timings.',
        results: companionResults,
      }, null, 2),
    );
    if (rechecks.length) writeFileSync(path.join(root, 'reports/shared-db/native-companion-recheck.json'), JSON.stringify({
      runId: process.env.SHARED_DB_MEASUREMENT_ID, notes: 'Three rounds of 50 paired iterations, alternating version order, same shared native fixture. Full first-run evidence remains unchanged.', results: rechecks,
    }, null, 2));
    console.log('PASS shared native PostgreSQL: Analysis values/scope/redaction, parity and configured warm iterations, companion margin workload');
  } finally { globalThis.fetch = originalFetch; await sql.end({ timeout: 5 }); }
}

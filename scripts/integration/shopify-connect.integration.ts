// Behavioral test for the Shopify direct store connect pipeline
// (spec docs/superpowers/specs/2026-07-08-shopify-client-store-connect-design.md).
// Needs TEST_DATABASE_URL (throwaway DB) — refuses prod. Run:
//   npm run test:client-portal-integration:setup   (drizzle schema)
//   npm run test:shopify-connect-integration
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.SHOPIFY_SYNC_ENABLED = 'true';

const { db, sql: pgClient } = await import('../../src/db/client');
const { patchCredentialAccount } = await import('../../src/services/credential-accounts');
const { syncShopifyOrders } = await import('../../src/services/shopify-order-sync');
const { listPortalIntegrations } = await import('../../src/lib/client-portal/read-models/integrations');

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  const same = actual === expected || Number(actual) === Number(expected);
  check(same, `${msg} (got ${String(actual)}, want ${String(expected)})`);
}

// Deletes only the rows this suite itself seeds (scoped by provider/name, not
// a table truncate) — used both as pre-seed cleanup and as best-effort
// teardown, so it still cleans up when main() throws before local ids (like
// accountId/clientId) are ever assigned.
async function cleanup(): Promise<void> {
  await db.execute(sql`delete from orders where source_provider = 'shopify'`);
  await db.execute(sql`delete from store_accounts where provider = 'shopify'`);
  await db.execute(sql`delete from clients where name = 'Shopify Test Client'`);
}

async function main(): Promise<number> {
  // order_items itself lives in the drizzle TS schema (created by
  // `drizzle-kit push` in setup.ts), but the refresh FUNCTION + TRIGGER that
  // keep it populated on every order insert/update are raw SQL migrations
  // `push` never applies. Apply them directly, each as ONE whole-file call —
  // 0025's function body is a `$$ … $$`-quoted block with internal semicolons
  // that the naive split-on-';' loop below would mangle, but postgres-js
  // `unsafe()` (no bind params here -> simple query protocol) runs a whole
  // multi-statement string atomically. Both files were verified
  // statement-by-statement to be idempotent (CREATE TABLE/INDEX IF NOT
  // EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE
  // TRIGGER, ON CONFLICT DO UPDATE backfills), so no try/catch/split is
  // needed even though order_items/analytics_cache already exist from the
  // drizzle push.
  for (const file of [
    'drizzle/0024_order_items_phase2.sql',
    'drizzle/0025_order_items_sync_trigger.sql',
  ]) {
    await pgClient.unsafe(readFileSync(file, 'utf8'));
  }

  // store_accounts lives outside the drizzle schema — apply its migrations directly.
  for (const file of [
    'drizzle/0027_credential_accounts_source_of_truth.sql',
    'drizzle/0037_store_account_sync_state.sql',
  ]) {
    for (const stmt of readFileSync(file, 'utf8').split(';')) {
      const trimmed = stmt.trim();
      if (trimmed) await pgClient.unsafe(trimmed);
    }
  }

  // ── seed ──
  await cleanup();
  // If clients has additional NOT NULL columns in your schema, copy the client
  // seed shape from scripts/integration/client-portal.integration.ts instead.
  const clientRows = await db.execute<{ id: number }>(sql`
    insert into clients (name) values ('Shopify Test Client') returning id
  `);
  const clientId = clientRows[0]!.id;
  // Rate-card note: Customer Shipping Rate projection (CP-040) is exercised by
  // the existing client-portal.integration.ts suite; this suite proves orders
  // arrive with the right clientId, which is the only new input to it.

  // 1) Portal-shaped submit: source='portal', active=false.
  const accountRows = await db.execute<{ id: number }>(sql`
    insert into store_accounts (client_id, provider, label, account_identifier, credentials, source, active)
    values (${clientId}, 'shopify', 'My Test Store', 'teststore.myshopify.com',
            ${JSON.stringify({ shopDomain: 'teststore.myshopify.com', accessToken: 'shpat_test' })}::jsonb,
            'portal', false)
    returning id
  `);
  const accountId = accountRows[0]!.id;

  // Pending rows are invisible to the sync even when the flag is on.
  const preResult = await syncShopifyOrders({
    fetchImpl: async () => {
      throw new Error('sync must not touch portal-pending accounts');
    },
  });
  eq(preResult.accounts, 0, 'pending (portal/inactive) account is not synced');

  // 2) Promote — must activate AND stamp the anchor.
  await patchCredentialAccount(pgClient as never, 'store_accounts', accountId, {
    hasSource: true,
    source: 'admin',
    hasLabel: false,
    label: null,
    labelGoesNull: false,
  });
  const promoted = await db.execute<{ active: boolean; anchor: Date | null }>(sql`
    select active, sync_anchor_at as anchor from store_accounts where id = ${accountId}
  `);
  eq(promoted[0]!.active, true, 'promotion activates the account');
  check(promoted[0]!.anchor != null, 'promotion stamps sync_anchor_at');

  // Backdate the anchor so fixtures created "now-ish" clear the floor while a
  // pre-anchor fixture stays excluded.
  await db.execute(sql`
    update store_accounts set sync_anchor_at = now() - interval '1 hour' where id = ${accountId}
  `);

  // 3) Sync with a stubbed Shopify: one order after the anchor, one before.
  const nowIso = new Date().toISOString();
  const oldIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const orderNode = (id: string, createdAt: string) => ({
    id: `gid://shopify/Order/${id}`,
    legacyResourceId: id,
    name: `#${id}`,
    createdAt,
    updatedAt: createdAt,
    cancelledAt: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    email: 'buyer@example.com',
    shippingAddress: { name: 'Pat Buyer', city: 'Austin', provinceCode: 'TX', zip: '78701' },
    currentTotalPriceSet: { shopMoney: { amount: '25.00' } },
    totalShippingPriceSet: { shopMoney: { amount: '5.00' } },
    lineItems: {
      nodes: [{ sku: 'SKU-9', title: 'Widget', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '25.00' } }, image: null }],
    },
  });
  const happyFetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [orderNode('9001', nowIso), orderNode('8000', oldIso)],
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  const syncResult = await syncShopifyOrders({ fetchImpl: happyFetch });
  eq(syncResult.accounts, 1, 'promoted account is synced');
  eq(syncResult.synced, 1, 'only the post-anchor order imports (forward-only)');

  const imported = await db.execute<{
    clientId: number | null;
    storeId: number | null;
    sourceProvider: string | null;
    orderStatus: string;
  }>(sql`
    select client_id as "clientId", store_id as "storeId",
           source_provider as "sourceProvider", order_status as "orderStatus"
    from orders where external_order_id = 'shopify-9001'
  `);
  check(imported.length === 1, 'order shopify-9001 landed in orders');
  eq(imported[0]!.clientId, clientId, 'order attributed to the connecting client');
  eq(imported[0]!.storeId, 9_200_000 + accountId, 'synthetic shopify store id');
  eq(imported[0]!.sourceProvider, 'shopify', 'source provider recorded');
  eq(imported[0]!.orderStatus, 'awaiting_shipment', 'unfulfilled -> awaiting_shipment');
  const excluded = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from orders where external_order_id = 'shopify-8000'
  `);
  eq(excluded[0]!.n, 0, 'pre-anchor order was NOT imported');

  const items = await db.execute<{ sku: string }>(sql`
    select oi.sku from order_items oi
    join orders o on o.id = oi.order_id
    where o.external_order_id = 'shopify-9001'
  `);
  eq(items[0]?.sku, 'SKU-9', 'order_items fan-out ran');

  // 4) Portal read-model shows the store with sync status.
  const scope = {
    clientIds: [clientId],
    storeIds: [],
    isGlobal: false,
    isRestricted: true,
    userId: 'test-user',
    permissions: [],
    canViewFinancials: true,
    canViewCredentials: false,
    auditSource: 'background',
  } as never;
  const listed = await listPortalIntegrations(scope);
  const storeDto = listed.data.find((d: { type?: string }) => d.type === 'store') as
    | { lastSyncError: string | null; source: string | null; active: boolean }
    | undefined;
  check(!!storeDto, 'portal integrations list returns the store');
  eq(storeDto?.lastSyncError ?? null, null, 'no sync error after a clean sync');

  // 5) Auth failures increment the counter and pause at 3.
  const authFetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  for (let i = 1; i <= 3; i += 1) await syncShopifyOrders({ fetchImpl: authFetch });
  const afterAuth = await db.execute<{ err: string | null; count: number }>(sql`
    select last_sync_error as err, sync_failure_count as count from store_accounts where id = ${accountId}
  `);
  eq(afterAuth[0]!.err, 'auth', 'auth failure recorded');
  eq(afterAuth[0]!.count, 3, 'three consecutive auth failures counted');
  const paused = await syncShopifyOrders({
    fetchImpl: async () => {
      throw new Error('paused account must not be fetched');
    },
  });
  eq(paused.accounts, 0, 'account pauses after 3 consecutive auth failures');

  return failures;
}

let code = 1;
try {
  const failed = await main();
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    code = 1;
  } else {
    console.log('\nPASS shopify connect integration');
    code = 0;
  }
} catch (err) {
  console.error('\n✗ shopify connect integration suite errored:', err instanceof Error ? err.stack : err);
  code = 1;
} finally {
  try {
    await cleanup();
  } catch {
    /* best-effort cleanup */
  }
  await pgClient.end({ timeout: 5 });
}
process.exit(code);

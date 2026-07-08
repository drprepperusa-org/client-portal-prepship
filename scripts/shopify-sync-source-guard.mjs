// Pins the Shopify sync security spine (spec 2026-07-08):
//  - sync reads ONLY source='admin' AND active=true store_accounts
//  - forward-only anchor + cursor columns exist in the migration
//  - promotion stamps the anchor idempotently and activates
//  - the poller is gated behind SHOPIFY_SYNC_ENABLED
// CRLF-tolerant: substring checks only, no end-of-line anchors.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const syncSrc = readFileSync('src/services/shopify-order-sync.ts', 'utf8');
assert(syncSrc.includes("source = 'admin'"), 'shopify sync must filter source=admin');
assert(syncSrc.includes('active = true'), 'shopify sync must filter active=true');
assert(syncSrc.includes('sync_anchor_at is not null'), 'shopify sync must require a stamped anchor');
assert(syncSrc.includes('SHOPIFY_SYNC_ENABLED'), 'shopify sync must be flag-gated');
assert(syncSrc.includes('sync_failure_count'), 'shopify sync must track consecutive auth failures');

const migration = readFileSync('drizzle/0037_store_account_sync_state.sql', 'utf8');
for (const col of ['sync_anchor_at', 'sync_cursor_at', 'last_synced_at', 'last_sync_error', 'sync_failure_count']) {
  assert(migration.includes(col), `migration 0037 missing column ${col}`);
}

const credSrc = readFileSync('src/services/credential-accounts.ts', 'utf8');
assert(
  credSrc.includes('sync_anchor_at = COALESCE(sync_anchor_at, NOW())'),
  'store-account promotion must stamp the sync anchor idempotently',
);
assert(
  credSrc.includes("table === 'store_accounts' && patch.hasSource && patch.source === 'admin'"),
  'promotion side effects must be scoped to store_accounts admin promotion',
);

const connectorSrc = readFileSync('src/connectors/store/shopify.ts', 'utf8');
assert(connectorSrc.includes("SHOPIFY_ADMIN_API_VERSION = '2026-04'"), 'Shopify API version must stay pinned');
assert(connectorSrc.includes('X-Shopify-Access-Token'), 'connector must use token header auth');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:shopify-sync-source'] === 'node scripts/shopify-sync-source-guard.mjs',
  'package.json must expose guard:shopify-sync-source',
);
assert(
  pkg.scripts?.['test:shopify-order-normalization'] === 'tsx scripts/shopify-order-normalization-test.ts',
  'package.json must expose test:shopify-order-normalization',
);
console.log('PASS shopify sync source guard');

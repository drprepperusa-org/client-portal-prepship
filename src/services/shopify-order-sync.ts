// Shopify direct order sync (spec docs/superpowers/specs/2026-07-08-*.md).
// Orchestration only — the connector owns Shopify API calls + normalization.
//
// SECURITY SPINE: this service may only read store_accounts rows where
// source = 'admin' AND active = true. Portal-submitted rows (source='portal',
// active=false) are invisible here until an operator promotes them.
// Pinned by scripts/shopify-sync-source-guard.mjs.
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../lib/env';
import {
  fetchShopifyOrdersSince,
  normalizeShopifyOrder,
  normalizeShopDomain,
  type ShopifyFetch,
  type ShopifyOrderNode,
} from '../connectors/store/shopify';
import { upsertNormalizedStoreOrders, type NormalizedStoreOrder } from './store-order-import';

const AUTH_PAUSE_THRESHOLD = 3;

type ShopifyAccountRow = {
  id: number;
  clientId: number | null;
  accountIdentifier: string | null;
  credentials: Record<string, unknown> | null;
  syncAnchorAt: Date | string;
  syncCursorAt: Date | string | null;
};

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function loadActiveShopifyAccounts(): Promise<ShopifyAccountRow[]> {
  const rows = await db.execute<ShopifyAccountRow>(sql`
    select id,
           client_id as "clientId",
           account_identifier as "accountIdentifier",
           credentials,
           sync_anchor_at as "syncAnchorAt",
           sync_cursor_at as "syncCursorAt"
    from store_accounts
    where provider = 'shopify'
      and source = 'admin'
      and active = true
      and sync_anchor_at is not null
      and not (coalesce(last_sync_error, '') = 'auth' and sync_failure_count >= ${AUTH_PAUSE_THRESHOLD})
    order by id
  `);
  return rows;
}

async function recordSuccess(accountId: number, cursor: Date): Promise<void> {
  await db.execute(sql`
    update store_accounts
    set sync_cursor_at = ${cursor.toISOString()}::timestamptz,
        last_synced_at = now(),
        last_sync_error = null,
        sync_failure_count = 0,
        updated_at = now()
    where id = ${accountId}
  `);
}

async function recordFailure(accountId: number, reason: string): Promise<void> {
  await db.execute(sql`
    update store_accounts
    set last_sync_error = ${reason},
        sync_failure_count = case when ${reason} = 'auth' then sync_failure_count + 1 else sync_failure_count end,
        updated_at = now()
    where id = ${accountId}
  `);
}

async function syncOneAccount(
  account: ShopifyAccountRow,
  fetchImpl: ShopifyFetch | undefined,
): Promise<number> {
  const credentials = (account.credentials ?? {}) as { shopDomain?: unknown; accessToken?: unknown };
  const shopDomain =
    normalizeShopDomain(String(account.accountIdentifier ?? '')) ??
    normalizeShopDomain(String(credentials.shopDomain ?? ''));
  const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
  const anchor = toDate(account.syncAnchorAt);
  if (!shopDomain || !accessToken || !anchor) {
    await recordFailure(account.id, 'misconfigured');
    return 0;
  }
  if (account.clientId == null) {
    // Attribution is the whole point — never import unattributed orders.
    await recordFailure(account.id, 'no-client');
    return 0;
  }

  const updatedAtMin = toDate(account.syncCursorAt) ?? anchor;
  const fetched = await fetchShopifyOrdersSince({ shopDomain, accessToken, updatedAtMin, fetchImpl });
  if (!fetched.ok) {
    await recordFailure(account.id, fetched.reason);
    return 0;
  }

  const normalized: NormalizedStoreOrder[] = [];
  let maxUpdatedAt = updatedAtMin;
  for (const node of fetched.orders as ShopifyOrderNode[]) {
    const updatedAt = toDate(node.updatedAt);
    if (updatedAt && updatedAt > maxUpdatedAt) maxUpdatedAt = updatedAt;
    try {
      const order = normalizeShopifyOrder(node, {
        accountId: account.id,
        clientId: account.clientId,
        anchor,
      });
      if (order) normalized.push(order);
    } catch (err) {
      // One malformed order never aborts the batch.
      console.warn(
        `[shopify-sync] account ${account.id}: skipping malformed order ${node?.legacyResourceId ?? '?'}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const synced = normalized.length ? await upsertNormalizedStoreOrders(normalized) : 0;
  // Cursor only advances after the batch is fully persisted (crash-safe: a
  // re-run of the same window is an idempotent upsert).
  await recordSuccess(account.id, maxUpdatedAt);
  return synced;
}

export async function syncShopifyOrders(
  opts: { fetchImpl?: ShopifyFetch } = {},
): Promise<{ accounts: number; synced: number; errors: number }> {
  if (!env.SHOPIFY_SYNC_ENABLED) return { accounts: 0, synced: 0, errors: 0 };

  const accounts = await loadActiveShopifyAccounts();
  let synced = 0;
  let errors = 0;
  for (const account of accounts) {
    try {
      synced += await syncOneAccount(account, opts.fetchImpl);
    } catch (err) {
      // Per-account isolation: one broken store never blocks the others.
      errors += 1;
      console.error(
        `[shopify-sync] account ${account.id} failed:`,
        err instanceof Error ? err.message : err,
      );
      await recordFailure(account.id, 'internal').catch(() => undefined);
    }
  }
  return { accounts: accounts.length, synced, errors };
}

import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { carrierAccountClients, carrierAccounts } from '../../../db/schema/carrier-accounts';
import { toPortalIntegrationDto } from '../dto';
import type { ClientPortalScope } from '../scope';

/**
 * Integrations read-model: the merged carrier-account + store-account listing.
 * The POST /integrations submission flow intentionally stays in the route.
 */

function carrierScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) {
    predicates.push(inArray(carrierAccounts.clientId, scope.clientIds));
    predicates.push(inArray(carrierAccountClients.clientId, scope.clientIds));
  }
  if (!predicates.length) return sql`false`;
  return or(...predicates) ?? sql`false`;
}

type StoreRow = {
  id: number;
  clientId: number | null;
  provider: string | null;
  label: string | null;
  accountIdentifier: string | null;
  source: string | null;
  active: boolean | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  lastSyncError?: string | null;
  lastSyncedAt?: Date | string | null;
};

type StoreAccountExecutor = (query: SQL) => Promise<StoreRow[]>;

const executeStoreAccountQuery: StoreAccountExecutor = (query) => db.execute<StoreRow>(query);

/** Migration 0037 compatibility is the only allowed fallback. Operational,
 * permission, timeout, and connection failures must propagate to the route so
 * the customer receives an explicit unavailable response instead of `[]`. */
export function isMissingConnectionFreshnessColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== '42703') return false;
  const message = String(candidate.message ?? '').toLowerCase();
  return message.includes('last_sync_error') || message.includes('last_synced_at');
}

export async function listPortalStoreIntegrations(
  scope: ClientPortalScope,
  execute: StoreAccountExecutor = executeStoreAccountQuery,
) {
  // Mirrors carrierScopePredicate's fail-closed philosophy: a restricted
  // scope with no clientIds (for example, a storeIds-only login) matches
  // nothing instead of falling through to an unfiltered query.
  const scopeFilter = scope.isRestricted
    ? scope.clientIds.length
      ? sql`and client_id in (${sql.join(scope.clientIds.map((id) => sql`${id}`), sql`, `)})`
      : sql`and false`
    : sql``;

  let rows: StoreRow[];
  try {
    rows = await execute(sql`
      select id,
             client_id as "clientId",
             provider,
             label,
             account_identifier as "accountIdentifier",
             source,
             active,
             created_at as "createdAt",
             updated_at as "updatedAt",
             last_sync_error as "lastSyncError",
             last_synced_at as "lastSyncedAt"
      from store_accounts
      where (coalesce(active, true) = true or source = 'portal')
        ${scopeFilter}
      order by created_at desc
      limit 200
    `);
  } catch (error) {
    if (!isMissingConnectionFreshnessColumnError(error)) throw error;
    // Deployment predates migration 0037. Only the known missing freshness
    // columns permit this legacy query; any second failure still propagates.
    rows = await execute(sql`
      select id,
             client_id as "clientId",
             provider,
             label,
             account_identifier as "accountIdentifier",
             source,
             active,
             created_at as "createdAt",
             updated_at as "updatedAt"
      from store_accounts
      where (coalesce(active, true) = true or source = 'portal')
        ${scopeFilter}
      order by created_at desc
      limit 200
    `);
  }

  return rows.map((row) => toPortalIntegrationDto({ ...row, type: 'store' }));
}

export async function listPortalIntegrations(scope: ClientPortalScope) {
  const carrierRows = await db
    .select({
      id: carrierAccounts.id,
      clientId: carrierAccounts.clientId,
      provider: carrierAccounts.provider,
      label: carrierAccounts.label,
      accountIdentifier: carrierAccounts.accountIdentifier,
      source: carrierAccounts.source,
      active: carrierAccounts.active,
      createdAt: carrierAccounts.createdAt,
      updatedAt: carrierAccounts.updatedAt,
      assignedClientId: carrierAccountClients.clientId,
    })
    .from(carrierAccounts)
    .leftJoin(carrierAccountClients, eq(carrierAccountClients.carrierAccountId, carrierAccounts.id))
    .where(and(eq(carrierAccounts.active, true), carrierScopePredicate(scope)));

  const byId = new Map<number, ReturnType<typeof toPortalIntegrationDto>>();
  for (const row of carrierRows) {
    const existing = byId.get(row.id);
    const assignedClientIds = [
      ...(existing?.assignedClientIds ?? []),
      ...(row.assignedClientId ? [row.assignedClientId] : []),
    ];
    byId.set(row.id, toPortalIntegrationDto({ ...row, type: 'carrier', assignedClientIds }));
  }

  const storeRows = await listPortalStoreIntegrations(scope);
  return {
    data: [...storeRows, ...byId.values()],
    carrierCount: byId.size,
    storeCount: storeRows.length,
  };
}

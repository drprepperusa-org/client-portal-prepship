import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { clients } from '../db/schema/clients';
import { printQueue } from '../db/schema/print-queue';
import type { MergeJob, PrintQueueListScope, QueueSendJob } from './print-queue-types';

/** Client/store scope predicates + job ownership checks (extracted from print-queue.ts). */

export function normalizeScopeIds(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function intArraySql(values: number[]): SQL {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::int[]`;
}

export function printQueueScopePredicate(scope: PrintQueueListScope): SQL {
  /*
   * UNRESTRICTED MEANS UNRESTRICTED.
   *
   * A global token can still carry clientIds/storeIds — they describe who the caller happens to
   * be associated with, not a limit on what they may see. Narrowing by them whenever they were
   * present silently answered a smaller question than the one asked, and only when both lists
   * were empty did scopeRestricted get a say.
   *
   * That has now cost three separate defects. Analysis returned an empty page for a client whose
   * store was absent from the token (fixed in analysisOrderScopePredicate, whose comment says
   * "predicates.ts already returns early on !isRestricted; this had diverged"). Then on
   * 2026-08-30 the printable invoice showed Total Amount Due $0.00 above real line items, and
   * /reports showed a global admin $1,105.95 of a real $8,484.04 — 13% — with no error to
   * suggest anything was missing.
   *
   * The portal's own clientScopePredicate has always returned early here. printQueueScopePredicate now agrees,
   * so the two families cannot disagree again.
   *
   * Safe because every caller that supplies ids also supplies scopeRestricted: withBillingScope
   * (routes/billing.ts) and the print-queue route both set it from scope.isRestricted, and the
   * `?? {}` call sites supply no ids at all. Restriction and deny-by-default are untouched: a
   * restricted caller with ids still narrows, and a restricted caller with none still gets
   * `false`.
   */
  if (scope.scopeRestricted !== true) return sql`true`;
  const clientIds = normalizeScopeIds(scope.scopeClientIds);
  const storeIds = normalizeScopeIds(scope.scopeStoreIds);
  const predicates: SQL[] = [];

  if (clientIds.length) {
    predicates.push(sql`${printQueue.clientId} = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`exists (
      select 1 from ${clients}
      where ${clients.id} = ${printQueue.clientId}
        and ${clients.storeIds} && ${intArraySql(storeIds)}
    )`);
  }
  if (!predicates.length) {
    return scope.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export function printQueueClientScopePredicate(scope: PrintQueueListScope): SQL {
  /*
   * UNRESTRICTED MEANS UNRESTRICTED.
   *
   * A global token can still carry clientIds/storeIds — they describe who the caller happens to
   * be associated with, not a limit on what they may see. Narrowing by them whenever they were
   * present silently answered a smaller question than the one asked, and only when both lists
   * were empty did scopeRestricted get a say.
   *
   * That has now cost three separate defects. Analysis returned an empty page for a client whose
   * store was absent from the token (fixed in analysisOrderScopePredicate, whose comment says
   * "predicates.ts already returns early on !isRestricted; this had diverged"). Then on
   * 2026-08-30 the printable invoice showed Total Amount Due $0.00 above real line items, and
   * /reports showed a global admin $1,105.95 of a real $8,484.04 — 13% — with no error to
   * suggest anything was missing.
   *
   * The portal's own clientScopePredicate has always returned early here. printQueueClientScopePredicate now agrees,
   * so the two families cannot disagree again.
   *
   * Safe because every caller that supplies ids also supplies scopeRestricted: withBillingScope
   * (routes/billing.ts) and the print-queue route both set it from scope.isRestricted, and the
   * `?? {}` call sites supply no ids at all. Restriction and deny-by-default are untouched: a
   * restricted caller with ids still narrows, and a restricted caller with none still gets
   * `false`.
   */
  if (scope.scopeRestricted !== true) return sql`true`;
  const clientIds = normalizeScopeIds(scope.scopeClientIds);
  const storeIds = normalizeScopeIds(scope.scopeStoreIds);
  const predicates: SQL[] = [];

  if (clientIds.length) {
    predicates.push(sql`${clients.id} = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`${clients.storeIds} && ${intArraySql(storeIds)}`);
  }
  if (!predicates.length) {
    return scope.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export function normalizeClientIds(values: number[]): number[] {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

export async function assertPrintQueueClientsVisible(
  clientIds: number[],
  scope: PrintQueueListScope = {}
): Promise<void> {
  const ids = normalizeClientIds(clientIds);
  if (!ids.length) return;
  if (
    scope.scopeRestricted !== true &&
    !normalizeScopeIds(scope.scopeClientIds).length &&
    !normalizeScopeIds(scope.scopeStoreIds).length
  ) {
    return;
  }

  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(inArray(clients.id, ids), printQueueClientScopePredicate(scope)));

  if (rows.length !== ids.length) {
    throw new Error('One or more print queue clients are not authorized');
  }
}

export async function canViewQueueSendJob(
  job: QueueSendJob,
  scope: PrintQueueListScope = {}
): Promise<boolean> {
  try {
    await assertPrintQueueClientsVisible(job.clientIds, scope);
    return true;
  } catch {
    return false;
  }
}

export async function canViewMergeJob(
  job: MergeJob,
  scope: PrintQueueListScope = {}
): Promise<boolean> {
  try {
    await assertPrintQueueClientsVisible(job.clientIds, scope);
    return true;
  } catch {
    return false;
  }
}

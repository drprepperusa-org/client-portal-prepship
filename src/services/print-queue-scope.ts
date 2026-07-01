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

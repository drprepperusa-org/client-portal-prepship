import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { clientPortalAuditLogs } from '../../db/schema/client-portal-audit-logs';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { parsePositiveInt, requestedSearch, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

const clickBody = z.object({
  target: z.string().trim().min(1).max(100),
  to: z.string().trim().max(160).optional(),
  from: z.string().trim().max(160).optional(),
});

function uniqueIds(rows: Array<{ clientIds: number[]; storeIds: number[] }>, key: 'clientIds' | 'storeIds'): number[] {
  return Array.from(new Set(rows.flatMap((row) => row[key]).filter((id) => Number.isInteger(id) && id > 0)));
}

function intArrayLiteral(values: number[]): SQL {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::int[]`;
}

function readableList(labels: string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)));
}

function groupedStoreLabels(storeIds: number[], storeNames: Map<number, string>): string[] {
  const counts = new Map<string, number>();
  for (const storeId of storeIds) {
    const label = storeNames.get(storeId) ?? `Store #${storeId}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => (count > 1 ? `${label} (${count} stores)` : label));
}

function buildScopeLabel(
  row: { clientIds: number[]; storeIds: number[] },
  names: { clientNames: Map<number, string>; storeNames: Map<number, string> },
): string {
  const clientLabels = readableList(row.clientIds.map((id) => names.clientNames.get(id) ?? `Client #${id}`));
  const storeLabels = groupedStoreLabels(row.storeIds, names.storeNames);
  const storeBases = storeLabels.map((label) => label.replace(/\s+\(\d+ stores\)$/, ''));
  const visibleStoreLabels = storeLabels.filter((_, index) => !clientLabels.includes(storeBases[index] ?? ''));
  const parts = [...clientLabels, ...visibleStoreLabels];
  return parts.length ? parts.join(' / ') : 'Global';
}

async function loadAuditScopeNames(rows: Array<{ clientIds: number[]; storeIds: number[] }>) {
  const clientIds = uniqueIds(rows, 'clientIds');
  const storeIds = uniqueIds(rows, 'storeIds');
  const clientNames = new Map<number, string>();
  const storeNames = new Map<number, string>();
  const predicates: SQL[] = [];

  if (clientIds.length) predicates.push(inArray(clients.id, clientIds));
  if (storeIds.length) predicates.push(sql`${clients.storeIds} && ${intArrayLiteral(storeIds)}`);
  if (!predicates.length) return { clientNames, storeNames };

  const rowsWithNames = await db
    .select({
      id: clients.id,
      name: clients.name,
      storeIds: clients.storeIds,
    })
    .from(clients)
    .where(or(...predicates));

  for (const row of rowsWithNames) {
    const name = row.name || `Client #${row.id}`;
    clientNames.set(row.id, name);
    for (const storeId of row.storeIds ?? []) {
      if (storeIds.includes(Number(storeId))) storeNames.set(Number(storeId), name);
    }
  }

  return { clientNames, storeNames };
}

app.get('/audit-log', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  if (!clientPortalCapabilities(scope).canViewAudit) {
    await recordPortalAudit('portal.audit_log.denied', scope);
    return c.json({ error: 'Admin access required' }, 403);
  }

  const search = requestedSearch(c);
  const limit = Math.min(parsePositiveInt(c.req.query('limit')) ?? 100, 250);
  const where = and(
    ...[
      ne(clientPortalAuditLogs.event, 'portal.audit_log.view'),
      search
        ? or(
            ilike(clientPortalAuditLogs.event, `%${search}%`),
            ilike(clientPortalAuditLogs.actorEmail, `%${search}%`),
            ilike(clientPortalAuditLogs.actorUserId, `%${search}%`),
          )
        : undefined,
    ].filter(<T>(value: T | undefined): value is T => value !== undefined),
  );

  const rows = await db
    .select({
      id: clientPortalAuditLogs.id,
      event: clientPortalAuditLogs.event,
      actorUserId: clientPortalAuditLogs.actorUserId,
      actorEmail: clientPortalAuditLogs.actorEmail,
      clientIds: clientPortalAuditLogs.clientIds,
      storeIds: clientPortalAuditLogs.storeIds,
      metadata: clientPortalAuditLogs.metadata,
      createdAt: clientPortalAuditLogs.createdAt,
    })
    .from(clientPortalAuditLogs)
    .where(where)
    .orderBy(desc(clientPortalAuditLogs.createdAt), desc(clientPortalAuditLogs.id))
    .limit(limit);
  const scopeNames = await loadAuditScopeNames(rows);

  return c.json({
    data: rows.map((row) => ({
      ...row,
      clientNames: row.clientIds.map((id) => scopeNames.clientNames.get(id) ?? `Client #${id}`),
      storeNames: groupedStoreLabels(row.storeIds, scopeNames.storeNames),
      scopeLabel: buildScopeLabel(row, scopeNames),
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

app.post('/audit-log/click', zValidator('json', clickBody), async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  const body = c.req.valid('json');
  await recordPortalAudit('portal.ui.click', scope, {
    target: body.target,
    to: body.to ?? null,
    from: body.from ?? null,
  });

  return c.json({ ok: true });
});

export default app;

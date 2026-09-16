import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lt, ilike, inArray, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { clientPortalAuditLogs } from '../../db/schema/client-portal-audit-logs';
import { recordPortalAudit, sanitizePortalAuditMetadata } from '../../lib/client-portal/audit';
import { buildPortalAuditActivity } from '../../lib/client-portal/read-models/audit-log-activity';
import { auditInvestigationPredicates } from '../../lib/client-portal/read-models/audit-log-classification';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { auditActivityStorePredicate } from '../../lib/client-portal/read-models/audit-log-store-attribution';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { parsePositiveInt, requestedSearch, scopeOrResponse } from '../../lib/client-portal/query-params';
import { auditCsv, AUDIT_EXPORT_MAX_ROWS } from '../../lib/client-portal/audit-csv';

const app = new Hono();

const investigationQuery = z.object({
  format: z.enum(['csv']).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  activity: z.enum(['all', 'views', 'actions', 'navigation', 'failed', 'denied']).default('all'),
  hideBackground: z.enum(['true', 'false']).default('false'),
}).refine(value => !value.dateFrom || !value.dateTo || Date.parse(value.dateFrom) < Date.parse(value.dateTo));

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

async function loadAuditStoreFilters(): Promise<Array<{ id: number; name: string }>> {
  const rows = await db
    .select({
      name: clients.name,
      storeIds: clients.storeIds,
    })
    .from(clients)
    .where(sql`cardinality(${clients.storeIds}) > 0`);

  const baseNames = new Map<number, string>();
  for (const row of rows) {
    for (const storeId of row.storeIds ?? []) {
      const id = Number(storeId);
      if (Number.isInteger(id) && id > 0 && !baseNames.has(id)) {
        baseNames.set(id, row.name?.trim() || `Store #${id}`);
      }
    }
  }

  const duplicateCounts = new Map<string, number>();
  for (const name of baseNames.values()) {
    duplicateCounts.set(name, (duplicateCounts.get(name) ?? 0) + 1);
  }

  return [...baseNames.entries()]
    .map(([id, name]) => ({
      id,
      name: (duplicateCounts.get(name) ?? 0) > 1 ? `${name} · Store #${id}` : name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
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
  const parsed = investigationQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid audit filters or date range' }, 400);
  const investigation = parsed.data;
  const exporting = investigation.format === 'csv';
  const limit = exporting ? AUDIT_EXPORT_MAX_ROWS : Math.min(parsePositiveInt(c.req.query('limit')) ?? 100, 250);
  const storeId = parsePositiveInt(c.req.query('storeId'));
  const actorEmail = c.req.query('actorEmail')?.trim();
  const page = exporting ? 1 : Math.min(parsePositiveInt(c.req.query('page')) ?? 1, 1_000_000);
  const where = and(
    ...[
      ne(clientPortalAuditLogs.event, 'portal.audit_log.view'),
      investigation.dateFrom ? gte(clientPortalAuditLogs.createdAt, new Date(investigation.dateFrom)) : undefined,
      investigation.dateTo ? lt(clientPortalAuditLogs.createdAt, new Date(investigation.dateTo)) : undefined,
      ...auditInvestigationPredicates(sql`${clientPortalAuditLogs.event}`, {
        ...investigation, hideBackground: investigation.hideBackground === 'true',
      }),
      actorEmail ? eq(clientPortalAuditLogs.actorEmail, actorEmail) : undefined,
      search
        ? or(
            ilike(clientPortalAuditLogs.event, `%${search}%`),
            ilike(clientPortalAuditLogs.actorEmail, `%${search}%`),
            ilike(clientPortalAuditLogs.actorUserId, `%${search}%`),
          )
        : undefined,
      storeId
        ? auditActivityStorePredicate(storeId)
        : undefined,
    ].filter(<T>(value: T | undefined): value is T => value !== undefined),
  );

  const [pageRows, storeFilters, userFilters] = await Promise.all([
    db
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
      .limit(limit + 1)
      .offset((page - 1) * limit),
    exporting ? [] : loadAuditStoreFilters(),
    // Discover actors across saved history, not just the current 100-row page.
    exporting ? [] : db.selectDistinct({ email: clientPortalAuditLogs.actorEmail })
      .from(clientPortalAuditLogs)
      .where(and(isNotNull(clientPortalAuditLogs.actorEmail), ne(clientPortalAuditLogs.event, 'portal.audit_log.view')))
      .orderBy(asc(clientPortalAuditLogs.actorEmail)),
  ]);
  if (exporting && pageRows.length > AUDIT_EXPORT_MAX_ROWS) {
    return c.json({ error: 'Too many events to export. Narrow the date range or filters and try again.' }, 413);
  }
  const rows = pageRows.slice(0, limit);
  const scopeNames = await loadAuditScopeNames(rows);
  const data = rows.map((row) => {
    const metadata = sanitizePortalAuditMetadata(row.metadata) as Record<string, unknown>;
    return {
      ...row,
      metadata,
      activity: buildPortalAuditActivity(row.event, metadata),
      clientNames: row.clientIds.map((id) => scopeNames.clientNames.get(id) ?? `Client #${id}`),
      storeNames: groupedStoreLabels(row.storeIds, scopeNames.storeNames),
      scopeLabel: buildScopeLabel(row, scopeNames),
      createdAt: row.createdAt.toISOString(),
    };
  });
  if (exporting) {
    const csv = auditCsv(data);
    if (csv === null) return c.json({ error: 'Export is too large. Narrow the date range or filters and try again.' }, 413);
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  }
  return c.json({
    data,
    filters: {
      stores: storeFilters,
      users: userFilters.flatMap((user) => user.email ? [user.email] : []),
    },
    pagination: { page, pageSize: limit, hasMore: pageRows.length > limit },
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

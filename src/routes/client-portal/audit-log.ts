import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, ilike, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { clientPortalAuditLogs } from '../../db/schema/client-portal-audit-logs';
import { isAdminEmail } from '../../lib/admin-emails';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope, type ClientPortalScope } from '../../lib/client-portal/scope';
import { parsePositiveInt, requestedSearch, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

const clickBody = z.object({
  target: z.string().trim().min(1).max(100),
  to: z.string().trim().max(160).optional(),
  from: z.string().trim().max(160).optional(),
});

function canViewAuditLog(scope: ClientPortalScope): boolean {
  return isAdminEmail(scope.email) || scope.role === 'admin';
}

app.get('/audit-log', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  if (!canViewAuditLog(scope)) {
    await recordPortalAudit('portal.audit_log.denied', scope);
    return c.json({ error: 'Admin access required' }, 403);
  }

  const search = requestedSearch(c);
  const limit = Math.min(parsePositiveInt(c.req.query('limit')) ?? 100, 250);
  const where = and(
    ...[
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

  await recordPortalAudit('portal.audit_log.view', scope, { rows: rows.length, search: search || null });

  return c.json({
    data: rows.map((row) => ({
      ...row,
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

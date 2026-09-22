import { sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clientPortalAuditLogs } from '../../../db/schema/client-portal-audit-logs';
import { sanitizePortalAuditMetadata } from '../audit';
import type { PortalClientActivityEvent, PortalClientActivityResponse } from '../contracts/access';
import { auditActivityClientIds } from './audit-log-client-attribution';
import { auditEventCategory } from './audit-log-classification';
import { buildPortalAuditActivity } from './audit-log-activity';

type RecordedEvent = {
  id: number; event: string; actorEmail: string | null; actorUserId: string | null;
  createdAt: string; metadata: Record<string, unknown>;
};
function eventDto(event: RecordedEvent): PortalClientActivityEvent {
  const metadata = sanitizePortalAuditMetadata(event.metadata) as Record<string, unknown>;
  return { id: event.id, actorEmail: event.actorEmail, actorUserId: event.actorUserId, createdAt: event.createdAt,
    activity: buildPortalAuditActivity(event.event, metadata) };
}

export async function readClientActivity(opts: { search: string; page: number; days: number }, now = new Date()): Promise<PortalClientActivityResponse> {
  const pageSize = 25;
  const dateTo = now.toISOString();
  const dateFrom = new Date(now.getTime() - opts.days * 86_400_000).toISOString();
  // One time-bounded scan; attribute each event once, never aggregate the audit UI's first 100 rows.
  const result = await db.execute<{
    clientId: number; clientName: string; active: boolean; failedCount: number; deniedCount: number;
    latestEvent: RecordedEvent | null; recentActions: RecordedEvent[] | null;
  }>(sql`with selected_clients as materialized (
      select id, name, active from clients
      where name ilike ${'%' + opts.search + '%'} order by lower(name), id
      limit ${pageSize + 1} offset ${(opts.page - 1) * pageSize}
    ), recent as materialized (
      select id, event, actor_email, actor_user_id, metadata, created_at,
        ${auditActivityClientIds()} as activity_client_ids,
        ${auditEventCategory(sql`${clientPortalAuditLogs.event}`)} as category
      from ${clientPortalAuditLogs}
      where created_at >= ${dateFrom}::timestamptz and created_at < ${dateTo}::timestamptz
        and event <> 'portal.audit_log.view'
        and ${auditEventCategory(sql`${clientPortalAuditLogs.event}`)} <> 'Background check'
    ), matched as (
      select c.id as client_id, r.*,
        row_number() over (partition by c.id order by r.created_at desc, r.id desc) as latest_rank,
        row_number() over (partition by c.id, (r.category in ('Action','Navigation')) order by r.created_at desc, r.id desc) as action_rank,
        jsonb_build_object('id',r.id,'event',r.event,'actorEmail',r.actor_email,'actorUserId',r.actor_user_id,
          'createdAt',r.created_at,'metadata',r.metadata) as detail
      from selected_clients c join recent r on c.id = any(r.activity_client_ids)
    ), grouped as (
      select client_id,
        count(*) filter (where event like '%.failed')::int as failed_count,
        count(*) filter (where event like '%.denied')::int as denied_count,
        (jsonb_agg(detail) filter (where latest_rank = 1))->0 as latest_event,
        jsonb_agg(detail order by created_at desc, id desc)
          filter (where category in ('Action','Navigation') and action_rank <= 3) as recent_actions
      from matched group by client_id
    ) select c.id as "clientId", c.name as "clientName", c.active,
      coalesce(g.failed_count,0) as "failedCount", coalesce(g.denied_count,0) as "deniedCount",
      g.latest_event as "latestEvent", g.recent_actions as "recentActions"
    from selected_clients c left join grouped g on g.client_id=c.id order by lower(c.name), c.id`);
  return {
    data: result.slice(0, pageSize).map(row => ({ ...row,
      latestEvent: row.latestEvent ? eventDto(row.latestEvent) : null,
      recentActions: (row.recentActions ?? []).map(eventDto),
    })),
    window: { dateFrom, dateTo, days: opts.days },
    pagination: { page: opts.page, pageSize, hasMore: result.length > pageSize },
  };
}

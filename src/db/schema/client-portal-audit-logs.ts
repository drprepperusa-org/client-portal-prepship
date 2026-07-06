import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const clientPortalAuditLogs = pgTable(
  'client_portal_audit_logs',
  {
    id: serial().primaryKey(),
    event: text().notNull(),
    actorUserId: text('actor_user_id'),
    actorEmail: text('actor_email'),
    clientIds: integer('client_ids').array().default([]).notNull(),
    storeIds: integer('store_ids').array().default([]).notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('client_portal_audit_logs_created_at_idx').on(t.createdAt),
    index('client_portal_audit_logs_actor_email_idx').on(t.actorEmail),
    index('client_portal_audit_logs_event_idx').on(t.event),
  ],
);

export type ClientPortalAuditLog = typeof clientPortalAuditLogs.$inferSelect;
export type NewClientPortalAuditLog = typeof clientPortalAuditLogs.$inferInsert;

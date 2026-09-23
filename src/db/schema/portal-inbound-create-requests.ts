import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { inboundShipments } from './inbound';

/** Backend-only save receipts. No customer DTO exposes actor/key/hash. */
export const portalInboundCreateRequests = pgTable('portal_inbound_create_requests', {
  actorUserId: text().notNull(),
  requestKey: uuid().notNull(),
  requestHash: text().notNull(),
  inboundId: integer().references(() => inboundShipments.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, table => [
  primaryKey({ columns: [table.actorUserId, table.requestKey] }),
  index('portal_inbound_create_requests_inbound_idx').on(table.inboundId),
  check('portal_inbound_create_requests_request_hash_check', sql`length(${table.requestHash}) = 64`),
]).enableRLS();

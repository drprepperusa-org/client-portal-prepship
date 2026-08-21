import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { orders } from './orders';

// CP-061 — READ-ONLY mirror of the canonical PS-502 replacement tables owned by
// prepship-v4 (its src/db/schema/replacements.ts, migrations 0096-0101).
//
// The Client Portal is a shadow renderer: it SELECTs these rows and never
// writes them. Only the columns the portal read model consumes are mirrored;
// operator/internal columns (review, admin override, idempotency, signature,
// fingerprint, liability, billable) are deliberately absent so they cannot be
// selected here by accident.
//
// The tables do NOT exist in the shared production database yet — the
// migrations are operator-lane and unapplied. Every read must go through
// replacementsSchemaReady() (src/lib/client-portal/replacements-schema-readiness.ts)
// and fail soft while the schema is absent.
export const replacements = pgTable('replacements', {
  id: serial().primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  clientId: integer('client_id').references(() => clients.id),
  reference: text().notNull(),
  status: text().notNull().default('requested'),
  reason: text().notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const replacementItems = pgTable('replacement_items', {
  id: serial().primaryKey(),
  replacementId: integer('replacement_id')
    .notNull()
    .references(() => replacements.id, { onDelete: 'cascade' }),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  sku: text().notNull(),
  name: text(),
  quantity: integer().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReplacementRow = typeof replacements.$inferSelect;
export type ReplacementItemRow = typeof replacementItems.$inferSelect;

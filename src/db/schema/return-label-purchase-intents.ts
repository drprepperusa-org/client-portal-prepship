import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { returns } from './returns';
import { shipments } from './shipments';

// CP-057 durable coordination for the external postage side effect.
//
// This is NOT a second label source of truth. `shipments` remains canonical for
// purchased label/tracking/cost facts. The two JSON fields are recovery-only
// snapshots and are cleared as soon as the canonical shipment is linked.
export const returnLabelPurchaseIntents = pgTable(
  'return_label_purchase_intents',
  {
    id: serial().primaryKey(),
    returnId: integer()
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    state: text().default('reserved').notNull(),
    provider: text().default('shipstation').notNull(),
    providerReferenceKey: text().notNull(),
    providerLabelId: text(),
    providerShipmentId: text(),
    returnShipmentId: integer().references(() => shipments.id, { onDelete: 'set null' }),
    attemptCount: integer().default(0).notNull(),
    generation: integer().default(0).notNull(),
    leaseToken: text(),
    leaseExpiresAt: timestamp({ withTimezone: true }),
    selectedRateJson: jsonb().$type<Record<string, unknown> | null>(),
    providerReceiptJson: jsonb().$type<Record<string, unknown> | null>(),
    lastSafeError: text(),
    resolutionNote: text(),
    resolvedBy: text(),
    reservedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastAttemptAt: timestamp({ withTimezone: true }),
    purchasedAt: timestamp({ withTimezone: true }),
    reconciledAt: timestamp({ withTimezone: true }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('return_label_purchase_intents_return_idx').on(t.returnId),
    uniqueIndex('return_label_purchase_intents_provider_ref_idx').on(t.providerReferenceKey),
    index('return_label_purchase_intents_state_idx').on(t.state, t.updatedAt),
    index('return_label_purchase_intents_state_lease_idx').on(t.state, t.leaseExpiresAt),
    check('return_label_purchase_intents_generation_check', sql`${t.generation} >= 0`),
    check(
      'return_label_purchase_intents_state_check',
      sql`${t.state} in ('reserved', 'purchasing', 'purchased', 'unknown_outcome', 'failed', 'completed')`,
    ),
  ],
);

export type ReturnLabelPurchaseIntent = typeof returnLabelPurchaseIntents.$inferSelect;

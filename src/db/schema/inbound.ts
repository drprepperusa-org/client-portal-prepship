import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { clients } from './clients';

/**
 * Inbound (receiving) shipments — purchase orders / ASNs arriving at the
 * warehouse. Manually entered by an operator/admin today; an Amazon-inbound or
 * supplier-feed importer can populate the same tables later.
 *
 * status: 'expected' | 'in_transit' | 'received' | 'cancelled'
 */
export const inboundShipments = pgTable('inbound_shipments', {
  id: serial().primaryKey(),
  clientId: integer().references(() => clients.id),
  reference: text(), // PO# / ASN / supplier reference
  supplier: text(),
  status: text().default('expected').notNull(),
  carrier: text(),
  trackingNumber: text(),
  expectedDate: timestamp({ withTimezone: true }),
  receivedDate: timestamp({ withTimezone: true }),
  notes: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const inboundItems = pgTable('inbound_items', {
  id: serial().primaryKey(),
  inboundId: integer()
    .references(() => inboundShipments.id, { onDelete: 'cascade' })
    .notNull(),
  sku: text(),
  name: text(),
  expectedQty: integer().default(0).notNull(),
  receivedQty: integer().default(0).notNull(),
});

export type InboundShipment = typeof inboundShipments.$inferSelect;
export type NewInboundShipment = typeof inboundShipments.$inferInsert;
export type InboundItem = typeof inboundItems.$inferSelect;
export type NewInboundItem = typeof inboundItems.$inferInsert;

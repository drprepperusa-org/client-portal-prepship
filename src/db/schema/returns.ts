import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clients } from './clients';
import { orders } from './orders';
import { orderItems } from './order-items';
import { shipments } from './shipments';
import { locations } from './locations';

// CP-026 — Returns data model.
//
// SOURCE-OF-TRUTH BOUNDARY (important): the return LABEL/tracking/cost truth
// stays on `shipments` (isReturn = true, returnForShipmentId, labelUrl,
// labelTracking, labelCost, cost, selectedRateJson). These tables own only the
// return WORKFLOW/UI state and the item/inspection/media detail that shipments
// cannot represent. Nothing here duplicates label money or tracking.

/**
 * Return workflow record. One row per return request for an order. The linked
 * return shipment (`returnShipmentId` → shipments.isReturn) remains the SOT for
 * the label, tracking, and cost — this row never stores those. It owns lifecycle
 * status, who started it, the return-to location, and the admin-override audit.
 */
export const returns = pgTable(
  'returns',
  {
    id: serial().primaryKey(),
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    clientId: integer().references(() => clients.id),
    // Nullable until the return label is created (the label lives on shipments).
    returnShipmentId: integer().references(() => shipments.id, { onDelete: 'set null' }),
    returnToLocationId: integer().references(() => locations.id),
    // requested | label_created | in_transit | received | inspected | closed | cancelled
    status: text().default('requested').notNull(),
    // 'client' or 'three_pl' — who started the return.
    initiatedBy: text().notNull(),
    initiatedByEmail: text(),
    reason: text(),
    // Duplicate-active-return control: a second active return for the same order
    // is blocked unless an admin explicitly overrides (audited below).
    adminOverride: boolean().default(false).notNull(),
    adminOverrideBy: text(),
    adminOverrideReason: text(),
    requestedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('returns_order_idx').on(t.orderId),
    index('returns_client_idx').on(t.clientId),
    index('returns_shipment_idx').on(t.returnShipmentId),
    index('returns_status_idx').on(t.status),
    // One ACTIVE, non-override return per order. Admin-override rows are excluded
    // from the constraint, so an explicit override can create an additional one.
    uniqueIndex('returns_one_active_per_order_idx')
      .on(t.orderId)
      .where(sql`${t.adminOverride} = false and ${t.status} not in ('cancelled', 'closed')`),
  ]
);

/**
 * Which order items/quantities are being returned. Supports partial returns;
 * quantity is app-enforced to not exceed the ordered quantity, and a DB check
 * keeps it positive. Links to canonical order_items where available.
 */
export const returnItems = pgTable(
  'return_items',
  {
    id: serial().primaryKey(),
    returnId: integer()
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    orderId: integer().references(() => orders.id),
    // Nullable — the ticket says "orderItemId when available".
    orderItemId: integer().references(() => orderItems.id),
    sku: text().notNull(),
    name: text(),
    quantity: numeric({ precision: 12, scale: 3 }).default('0').notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('return_items_return_idx').on(t.returnId),
    index('return_items_order_item_idx').on(t.orderItemId),
    index('return_items_sku_idx').on(t.sku),
  ]
);

/**
 * 3PL receiving / inspection of a returned shipment: received date, condition,
 * comments, and the inspector's identity. Media (photos/video) hangs off this.
 */
export const returnInspections = pgTable(
  'return_inspections',
  {
    id: serial().primaryKey(),
    returnId: integer()
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    returnShipmentId: integer().references(() => shipments.id, { onDelete: 'set null' }),
    receivedAt: timestamp({ withTimezone: true }),
    // sellable | damaged | unsellable | partial | ...
    condition: text(),
    // pending | passed | failed | ...
    status: text().default('pending').notNull(),
    comments: text(),
    inspectorEmail: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('return_inspections_return_idx').on(t.returnId),
    index('return_inspections_shipment_idx').on(t.returnShipmentId),
  ]
);

/**
 * Photo/video evidence for an inspection. Stores attachment metadata + a storage
 * reference (S3/Supabase key or URL); the binary itself lives in object storage.
 */
export const returnInspectionMedia = pgTable(
  'return_inspection_media',
  {
    id: serial().primaryKey(),
    inspectionId: integer()
      .notNull()
      .references(() => returnInspections.id, { onDelete: 'cascade' }),
    // 'photo' or 'video'.
    mediaType: text().notNull(),
    // Object-storage key or URL (never the binary).
    storageRef: text().notNull(),
    contentType: text(),
    sizeBytes: integer(),
    capturedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('return_inspection_media_inspection_idx').on(t.inspectionId)]
);

export type Return = typeof returns.$inferSelect;
export type NewReturn = typeof returns.$inferInsert;
export type ReturnItem = typeof returnItems.$inferSelect;
export type NewReturnItem = typeof returnItems.$inferInsert;
export type ReturnInspection = typeof returnInspections.$inferSelect;
export type NewReturnInspection = typeof returnInspections.$inferInsert;
export type ReturnInspectionMedia = typeof returnInspectionMedia.$inferSelect;
export type NewReturnInspectionMedia = typeof returnInspectionMedia.$inferInsert;

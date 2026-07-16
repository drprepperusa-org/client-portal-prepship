import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clients } from './clients';
import { orders } from './orders';
import { shipments } from './shipments';

// Source-of-truth note: billing_config owns mutable billing rules. Generated
// billing_line_items should be treated as frozen billable records.
export const billingConfig = pgTable('billing_config', {
  clientId: integer()
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  pickPackFee: numeric({ precision: 10, scale: 2 }).default('0').notNull(),
  // Threshold — orders with units ≤ pickPackMaxUnits pay only pickPackFee.
  // Units beyond the threshold are charged additionalUnitFee each.
  // Default 1 matches v2's hardcoded constant (one included unit per order).
  pickPackMaxUnits: integer('pick_pack_max_units').default(1).notNull(),
  additionalUnitFee: numeric({ precision: 10, scale: 2 }).default('0').notNull(),
  packageCostMarkup: numeric({ precision: 5, scale: 2 }).default('0').notNull(),
  shippingMarkupPct: numeric({ precision: 5, scale: 2 }).default('0').notNull(),
  shippingMarkupFlat: numeric({ precision: 10, scale: 2 }).default('0').notNull(),
  // PS-366: below-trigger customer shipping override. When the selected/
  // purchased rate is below the trigger, the billed shipping line becomes the
  // override amount (NOT a floor — rates at/above the trigger are untouched).
  // 0 disables. HUGRAB: trigger 6.00, amount 7.73.
  shippingRateOverrideTriggerBelow: numeric('shipping_rate_override_trigger_below', { precision: 10, scale: 2 })
    .default('0')
    .notNull(),
  shippingRateOverrideAmount: numeric('shipping_rate_override_amount', { precision: 10, scale: 2 })
    .default('0')
    .notNull(),
  // ── CP-031: return billing (additive) ────────────────────────────────────
  // Per-return processing/handling fee, charged once per non-voided return
  // shipment in the billing period. 0 disables the return_processing_fee line.
  returnProcessingFee: numeric('return_processing_fee', { precision: 10, scale: 2 })
    .default('0')
    .notNull(),
  // Return postage markup, kept SEPARATE from the outbound shipping markup so a
  // client can be charged a different (or zero) markup on return labels than on
  // outbound. Applied to the return label's house cost (percent + flat). 0/0
  // means "bill the house cost as-is".
  returnPostageMarkupPct: numeric('return_postage_markup_pct', { precision: 5, scale: 2 })
    .default('0')
    .notNull(),
  returnPostageMarkupFlat: numeric('return_postage_markup_flat', { precision: 10, scale: 2 })
    .default('0')
    .notNull(),
  // Return postage minimum/customer-visible price hook — mirrors the PS-366
  // outbound below-trigger override but with its OWN return-specific config so a
  // cheap return label (house cost < trigger) can be billed at a floor display
  // price. e.g. trigger 6.00 / amount 7.73: a $5.99 return-label house cost
  // bills 7.73; a $6.82 house cost keeps its marked-up amount. 0 disables.
  returnShippingRateOverrideTriggerBelow: numeric('return_shipping_rate_override_trigger_below', { precision: 10, scale: 2 })
    .default('0')
    .notNull(),
  returnShippingRateOverrideAmount: numeric('return_shipping_rate_override_amount', { precision: 10, scale: 2 })
    .default('0')
    .notNull(),
  // Monthly storage fee in dollars per cubic-foot of inventory on hand.
  // v2 computed storage line items from inventory_ledger deltas × cuFtOverride
  // (or default L×W×H/1728). 0 disables storage billing entirely.
  storageFeePerCuFt: numeric('storage_fee_per_cu_ft', { precision: 10, scale: 4 })
    .default('0')
    .notNull(),
  billingMode: text().default('per_shipment').notNull(),
  active: boolean().default(true).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const billingLineItems = pgTable(
  'billing_line_items',
  {
    id: serial().primaryKey(),
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    orderId: integer().references(() => orders.id),
    orderNumber: text(),
    shipmentId: integer().references(() => shipments.id),
    shipDate: timestamp({ withTimezone: true }),
    // PS-434: PrepShip persists this backend-owned range/invoice bucket. The
    // portal is a shadow renderer and never calculates weekend roll-forward.
    billingEffectiveDate: timestamp('billing_effective_date', { withTimezone: true }),
    billingPolicyVersion: text('billing_policy_version'),
    lineType: text().notNull(),
    description: text().notNull(),
    qty: numeric({ precision: 10, scale: 2 }).default('1').notNull(),
    unitCost: numeric({ precision: 10, scale: 2 }).notNull(),
    totalCost: numeric({ precision: 10, scale: 2 }).notNull(),
    invoiced: boolean().default(false).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('billing_li_client_idx').on(t.clientId),
    index('billing_li_date_idx').on(t.shipDate),
    index('billing_li_effective_date_idx').on(
      sql`coalesce(${t.billingEffectiveDate}, ${t.shipDate})`,
    ),
    // Billed-shipping lookups by shipment (Shipments page parity with Billing).
    index('billing_li_shipment_idx').on(t.shipmentId),
    unique('billing_li_unique').on(t.orderId, t.lineType, t.description),
  ]
);

export type BillingConfig = typeof billingConfig.$inferSelect;
export type NewBillingConfig = typeof billingConfig.$inferInsert;
export type BillingLineItem = typeof billingLineItems.$inferSelect;

export const clientPackagePrices = pgTable(
  'client_package_prices',
  {
    clientId: integer()
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    packageId: integer().notNull(),
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    isCustom: boolean().default(false).notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('client_package_prices_pk_idx').on(t.clientId, t.packageId),
  ]
);

export const billingRefRates = pgTable(
  'billing_ref_rates',
  {
    id: serial().primaryKey(),
    weightOz: integer(),
    zipTo: text(),
    carrier: text(),
    service: text(),
    cost: numeric({ precision: 10, scale: 2 }),
    source: text(),
    fetchedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('billing_ref_rates_lookup_idx').on(t.weightOz, t.zipTo, t.carrier),
  ]
);

export type ClientPackagePrice = typeof clientPackagePrices.$inferSelect;
export type BillingRefRate = typeof billingRefRates.$inferSelect;

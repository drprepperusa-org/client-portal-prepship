/**
 * CP-059A — read-model support for Client Portal billing.
 *
 * WHAT THIS FILE IS NOT
 *
 * It is not a billing service. The Client Portal does not generate billing.
 * PrepShip (and the database) is the sole owner of `billing_line_items`
 * generation, relational return identity, canonical return vocabulary,
 * destination classification and billing money policy. The portal renders that
 * truth and decides none of it.
 *
 * This file exists because `src/services/billing.ts` was DELETED, not emptied.
 * That file owned `generateLineItems` — a second, independent generator that
 * deleted and rebuilt `billing_line_items` for a period. It is gone. Its scope
 * predicates and value formatters are still needed by the read models, so they
 * live here under a name that cannot be mistaken for an invitation to add
 * generation back.
 *
 * The retirement is therefore STRUCTURAL, not a comment: there is no
 * `services/billing.ts` in this repository for a generator to be re-added to.
 *
 * ALLOWED HERE
 *   - tenant/store scope predicates for READ queries
 *   - pure value formatters and summarisers
 *
 * NEVER ALLOWED HERE
 *   - INSERT, UPDATE or DELETE against billing_line_items
 *   - any period rebuild, regeneration or backfill
 *   - any billing money policy decision
 *
 * ps-cp-059a-writer-retirement-guard.ts enforces the above against active code.
 */
import { sql, type SQL } from 'drizzle-orm';
import { billingLineItems } from '../db/schema/billing';

/**
 * Scope + period input shared by the portal's billing READ models.
 *
 * The name is historical — it was the input to the retired generator. It is kept
 * because `billing-summaries.ts` and the read models type against it, and
 * renaming it would touch far more code than the retirement itself.
 */
export type GenerateInput = {
  clientId?: number;
  // Client-portal billing routes pass UTC-midnight calendar-day bounds from
  // billingDayRange. dateFrom is inclusive; dateTo is EXCLUSIVE day-after
  // midnight. Every ship_date comparison must use `>= dateFrom AND < dateTo`.
  dateFrom: string; // ISO, UTC midnight, inclusive
  dateTo: string; // ISO, UTC midnight, EXCLUSIVE
  scopeClientIds?: number[];
  scopeStoreIds?: number[];
  scopeRestricted?: boolean;
};

export function toNum(v: string | null | undefined) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeScopeIds(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function intArraySql(values: number[]): SQL {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::int[]`;
}

export function billingClientScopePredicate(input: GenerateInput): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(input.scopeClientIds);
  const storeIds = normalizeScopeIds(input.scopeStoreIds);

  if (clientIds.length) {
    predicates.push(sql`c.id = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`c.store_ids && ${intArraySql(storeIds)}`);
  }
  if (!predicates.length) {
    return input.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export function billingLineItemScopePredicate(input: GenerateInput): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(input.scopeClientIds);
  const storeIds = normalizeScopeIds(input.scopeStoreIds);

  if (clientIds.length) {
    predicates.push(sql`${billingLineItems.clientId} = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`exists (
      select 1 from clients scoped_client
      where scoped_client.id = ${billingLineItems.clientId}
        and scoped_client.store_ids && ${intArraySql(storeIds)}
    )`);
  }
  if (!predicates.length) {
    return input.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function itemSkuOrFallback(record: Record<string, unknown>): string | null {
  const sku =
    stringOrNull(record.sku) ??
    stringOrNull(record.fulfillmentSku) ??
    stringOrNull(record.warehouseLocation);
  if (sku) return sku;

  const productId = toFiniteNumber(record.productId);
  return productId != null ? String(Math.trunc(productId)) : null;
}

export function providerAccountIdOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized =
    typeof value === 'string' ? value.replace(/^se-/i, '') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function itemSummary(items: unknown) {
  if (!Array.isArray(items)) {
    return { itemNames: null, itemSkus: null, totalQty: null };
  }

  const names: string[] = [];
  const skus: string[] = [];
  let totalQty = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.adjustment === true) continue;

    const name = stringOrNull(record.name);
    const sku = itemSkuOrFallback(record);
    const qty = toFiniteNumber(record.quantity) ?? 1;

    if (name) names.push(name);
    if (sku) skus.push(sku);
    if (qty > 0) totalQty += qty;
  }

  return {
    itemNames: names.length ? [...new Set(names)].join(' | ') : null,
    itemSkus: skus.length ? [...new Set(skus)].join(' | ') : null,
    totalQty: totalQty > 0 ? totalQty : null,
  };
}

export function dimsKey(length: unknown, width: unknown, height: unknown) {
  const l = toFiniteNumber(length);
  const w = toFiniteNumber(width);
  const h = toFiniteNumber(height);
  if (l == null || w == null || h == null || l <= 0 || w <= 0 || h <= 0) {
    return null;
  }
  return `${l}x${w}x${h}`;
}

export function dimsLabel(length: unknown, width: unknown, height: unknown) {
  const key = dimsKey(length, width, height);
  return key ? `${key} in` : null;
}

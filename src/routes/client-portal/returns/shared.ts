import type { Context } from 'hono';
import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { orders } from '../../../db/schema/orders';
import { returns } from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';
import { clientPortalCapabilities } from '../../../lib/client-portal/capabilities';
import { intArrayLiteral } from '../../../lib/client-portal/predicates';
import type { ClientPortalScope } from '../../../lib/client-portal/scope';
import { baseReturnReference } from '../../../services/return-reference';

export const RETURN_STATUS_FILTERS = new Set([
  'requested',
  'label_created',
  'label_failed',
  'in_transit',
  'received',
  'inspected',
  'closed',
  'cancelled',
]);

export const RECEIVING_STATUSES = ['requested', 'label_created', 'in_transit', 'received'];

export const INSPECTION_CONDITIONS = new Set([
  'sealed_new',
  'opened_good',
  'damaged',
  'missing_item',
  'wrong_item',
  'other',
]);

export const INSPECTION_MEDIA_TYPES = new Set(['photo', 'video']);
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

export function canRecordAuthoritativeReturnInspection(scope: ClientPortalScope): boolean {
  return clientPortalCapabilities(scope).canInspectReturns;
}

export function operatorGateOrResponse(c: Context, scope: ClientPortalScope): Response | null {
  if (!canRecordAuthoritativeReturnInspection(scope)) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return null;
}

// A return is visible exactly when its canonical order is in the caller's scope.
export function returnScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {},
): SQL {
  const scopedPredicates: SQL[] = [];
  if (scope.isRestricted) {
    if (scope.clientIds.length) {
      scopedPredicates.push(sql`scoped_order.client_id = any(${intArrayLiteral(scope.clientIds)})`);
    }
    if (scope.storeIds.length) {
      scopedPredicates.push(sql`scoped_order.store_id = any(${intArrayLiteral(scope.storeIds)})`);
    }
  }
  const scopePredicate = !scope.isRestricted
    ? undefined
    : scopedPredicates.length === 0
      ? sql`false`
      : scopedPredicates.length === 1
        ? scopedPredicates[0]
        : (or(...scopedPredicates) ?? sql`false`);
  const orderPredicate = and(
    scopePredicate,
    filters.clientId ? sql`scoped_order.client_id = ${filters.clientId}` : undefined,
    filters.storeId ? sql`scoped_order.store_id = ${filters.storeId}` : undefined,
  );
  return sql`exists (
    select 1 from ${orders} scoped_order
    where scoped_order.id = ${returns.orderId}
      ${orderPredicate ? sql`and (${orderPredicate})` : sql``}
  )`;
}

export function returnSearchPredicate(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(returns.returnReference, pattern),
    ilike(orders.orderNumber, pattern),
    ilike(orders.externalOrderId, pattern),
    ilike(returns.reason, pattern),
    ilike(shipments.trackingNumber, pattern),
    ilike(shipments.labelTracking, pattern),
    sql`${returns.id}::text ilike ${pattern}`,
  );
}

export async function buildReturnReference(orderId: number, orderNumber: string | null): Promise<string> {
  const base = baseReturnReference(orderNumber, orderId);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(returns)
    .where(eq(returns.orderId, orderId));
  const next = Number(row?.count ?? 0) + 1;
  return next <= 1 ? base : `${base}-${next}`;
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The UTC calendar DAY (YYYY-MM-DD) of a timestamp — the canonical billing-day shape PS-487
 * uses (toISOString().slice(0,10)). A billing date is day-granular; returning the day rather
 * than a full instant lets the client render the same calendar day in any timezone instead of
 * a UTC-midnight instant a local formatter shifts across midnight.
 */
export function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const asIso = value instanceof Date ? value.toISOString() : value;
  return asIso.slice(0, 10);
}

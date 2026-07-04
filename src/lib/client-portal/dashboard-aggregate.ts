// Pure dashboard aggregation helpers, factored out of the client-portal route
// so they carry NO heavy imports (no db client, no Hono app). The route feeds
// them already-scoped order rows; a focused guard can import them directly to
// unit-test the per-SKU shipping allocation without booting a database.
//
// READ-ONLY: these functions only fold over rows the caller already fetched.
// They never query or mutate, so they are safe under the production data rails.

/**
 * Minimal structural shape of an order row consumed by the dashboard
 * aggregations. The route passes full `orders.$inferSelect` rows, which are
 * assignable to this — keeping the schema import out of this module.
 */
export interface DashboardOrderRow {
  items: unknown;
  orderDate: Date | string | null;
  orderTotal?: number | string | null;
  shippingAmount?: number | string | null;
}

// CP-021: the former `topSkuRows(...)` folder — which ranked Top-SKUs and
// allocated Avg Shipping Price by reducing a capped `orders.limit(1000)` array
// in JS — was REMOVED. Those business rankings/financials now come from the ONE
// canonical Analysis SKU query (src/lib/client-portal/read-models/dashboard.ts →
// dashboardTopSkus, over getSkuBreakdownFromOrderItems). The helpers below stay
// because they still power the non-ranking, non-financial per-day orders/units
// bar chart (`dailyOrderUnitsRows`), a bounded visual sample only.

/** A promo/discount line carries a negative unit price and is NOT a shippable
 *  item. Excluding it keeps the dashboard's unit counts and SKU rollups in
 *  lock-step with the order item list (src/lib/client-portal/dto.ts uses this
 *  same predicate), so every client-portal surface agrees on "units". */
export function isDiscountLine(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const row = item as Record<string, unknown>;
  const price = Number(row.unitPrice ?? row.unit_price ?? row.price);
  return Number.isFinite(price) && price < 0;
}

/** Sum of shippable line-item quantities on an order (ignores non-numeric/qty<=0
 *  and discount/promo lines). */
export function safeItemQty(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => {
    if (!item || typeof item !== 'object' || isDiscountLine(item)) return sum;
    const qty = Number((item as Record<string, unknown>).quantity ?? (item as Record<string, unknown>).qty ?? 0);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}

/** YYYY-MM-DD bucket key for an order date, or null when unparseable. */
export function dayKey(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Per-day order count + shippable unit count, ascending by day. Both metrics
 *  come from the same scoped row set so the Dashboard's cumulative bar always
 *  has aligned orders/units segments. */
export function dailyOrderUnitsRows(rows: DashboardOrderRow[]): Array<{ day: string; orders: number; units: number }> {
  const byDay = new Map<string, { day: string; orders: number; units: number }>();
  for (const row of rows) {
    const key = dayKey(row.orderDate);
    if (!key) continue;
    const current = byDay.get(key) ?? { day: key, orders: 0, units: 0 };
    current.orders += 1;
    current.units += safeItemQty(row.items);
    byDay.set(key, current);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

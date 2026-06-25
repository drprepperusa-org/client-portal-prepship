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

export interface TopSkuRow {
  sku: string;
  units30: number;
  units7: number;
  revenue: number;
  /**
   * Quantity-weighted average shipping price per unit for this SKU, or `null`
   * when no order carrying this SKU had a shipping charge (rendered as "—" in
   * the UI rather than a misleading $0.00). Always `null` when the caller may
   * not view financials.
   */
  avgShippingPrice: number | null;
}

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

/**
 * Top SKUs by 30-day unit count, with a quantity-share allocation of each
 * order's shipping charge across its SKU lines.
 *
 * Avg shipping price method (mirrors `sku-orders.ts`):
 *   - For each order, spread its `shippingAmount` across the SKU lines in
 *     proportion to each line's quantity share of the order. A multi-SKU order
 *     therefore never bills its full shipping to every SKU.
 *   - Per SKU: avg = (sum of allocated shipping) / (units that carried
 *     shipping). This is a per-unit average, consistent with the SKU drawer's
 *     `avgStandardShippingCost`.
 *   - Orders with no shipping charge (<= 0) contribute to neither the numerator
 *     nor the denominator, so a SKU with no real shipping data reports `null`.
 *   - When `canViewFinancials` is false, revenue and avg shipping are withheld
 *     (avgShippingPrice = null) — financial visibility is enforced here, not in
 *     the UI.
 */
export function topSkuRows(rows: DashboardOrderRow[], canViewFinancials = false): TopSkuRow[] {
  const bySku = new Map<string, { sku: string; units30: number; units7: number; revenue: number; shipAlloc: number; shipUnits: number }>();
  for (const row of rows) {
    if (!Array.isArray(row.items)) continue;
    const orderShipping = Number(row.shippingAmount ?? 0);
    const orderQty = safeItemQty(row.items);
    const allocate = canViewFinancials && orderShipping > 0 && orderQty > 0;
    for (const item of row.items) {
      if (!item || typeof item !== 'object' || isDiscountLine(item)) continue;
      const record = item as Record<string, unknown>;
      const sku = typeof record.sku === 'string' && record.sku.trim() ? record.sku : 'unknown';
      const qtyRaw = Number(record.quantity ?? record.qty ?? 0);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 0;
      const current = bySku.get(sku) ?? { sku, units30: 0, units7: 0, revenue: 0, shipAlloc: 0, shipUnits: 0 };
      current.units30 += qty;
      if (canViewFinancials) {
        const unitPrice = Number(record.unitPrice ?? record.unit_price ?? 0);
        current.revenue += (Number.isFinite(unitPrice) ? unitPrice : 0) * qty;
      }
      if (allocate && qty > 0) {
        current.shipAlloc += orderShipping * (qty / orderQty);
        current.shipUnits += qty;
      }
      bySku.set(sku, current);
    }
  }
  return [...bySku.values()]
    .sort((a, b) => b.units30 - a.units30)
    .slice(0, 10)
    .map(({ shipAlloc, shipUnits, ...rest }) => ({
      ...rest,
      avgShippingPrice: shipUnits > 0 ? shipAlloc / shipUnits : null,
    }));
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

/** Per-day revenue (order totals), ascending by day. */
export function dailyRevenueRows(rows: DashboardOrderRow[]): Array<{ day: string; revenue: number }> {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(row.orderDate);
    if (!key) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + Number(row.orderTotal ?? 0));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, revenue]) => ({ day, revenue }));
}

import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderItems } from '../../../db/schema/order-items';
import { orderOverrides, orders } from '../../../db/schema/orders';
import {
  HERITAGE_PREP_FEE_CLIENT_NAME,
  heritagePrepFeeRowsForRange,
} from '../../heritage-prep-fee-overrides';
import { billingDayBefore } from '../billing-day';
import { safeItems } from '../dto';
import { invoiceItemNameLinesSql } from '../invoice-items';
import { clientFilterPredicate, invoiceLineScopePredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';
import {
  BILLING_POLICY_WEEKEND_ROLLFORWARD,
  billingLineEffectiveDaySql,
} from '../../../services/billing-effective-day';

const invoiceEffectiveDay = billingLineEffectiveDaySql(
  sql`b.billing_effective_date`,
  sql`b.ship_date`,
);

/** orders.items jsonb (aggregated as text per order group) → structured
 *  item-identity lines (name/sku/quantity/imageUrl) via the shared shaper. */
function parseItemsJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Invoice-detail read-model (extracted from routes/client-portal.ts): the
 * canonical per-order billing line rollup that powers /invoice-details and the
 * printable /invoice. Qty comes from canonical order_items quantities, never
 * from summed billing line quantities. Pass page+pageSize to paginate (the
 * portal drill-in does — rendering thousands of rows at once is what made the
 * Billing page lag); omit them for the full capped list (printable invoice,
 * Excel export).
 */

type PortalInvoiceSummaryRow = {
  client_id: number;
  client_name: string | null;
  orders: string;
  pickpack_total: string;
  additional_total: string;
  package_total: string;
  shipping_total: string;
  storage_total: string;
  // CP-031: return charges broken out from the grand total so returns are a
  // visible billing category (they were already inside row_total, just hidden).
  returnpostage_total: string;
  returnprocessing_total: string;
  row_total: string;
};

/**
 * Per-client billing rollup computed entirely in SQL — no row cap, so the
 * Billing summary shows true order counts and totals no matter how many
 * line rows the range contains (the detail query is capped; this is not).
 * dateTo is the EXCLUSIVE UTC-midnight upper bound from billingDayRange.
 */
export async function portalInvoiceSummary(
  scope: ClientPortalScope,
  input: { clientId?: number | null; dateFrom: string; dateTo: string },
) {
  const rows = await db.execute<PortalInvoiceSummaryRow>(sql`
    select
      b.client_id,
      c.name as client_name,
      count(distinct b.order_id)::text as orders,
      coalesce(sum(case when b.line_type in ('pick_pack', 'pickpack') then b.total_cost else 0 end), 0)::text as pickpack_total,
      coalesce(sum(case when b.line_type in ('additional_unit', 'additional') then b.total_cost else 0 end), 0)::text as additional_total,
      coalesce(sum(case when b.line_type in ('package_cost', 'package') then b.total_cost else 0 end), 0)::text as package_total,
      coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)::text as shipping_total,
      coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end), 0)::text as storage_total,
      coalesce(sum(case when b.line_type = 'return_postage' then b.total_cost else 0 end), 0)::text as returnpostage_total,
      coalesce(sum(case when b.line_type = 'return_processing_fee' then b.total_cost else 0 end), 0)::text as returnprocessing_total,
      coalesce(sum(b.total_cost), 0)::text as row_total
    from billing_line_items b
    left join ${clients} c on c.id = b.client_id
    where coalesce(c.active, true) = true
      and ${invoiceEffectiveDay} >= ${input.dateFrom}::timestamptz
      and ${invoiceEffectiveDay} < ${input.dateTo}::timestamptz
      ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
      ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
    group by b.client_id, c.name
    order by sum(b.total_cost) desc
  `);
  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    orders: Number(row.orders) || 0,
    pickpackTotal: row.pickpack_total,
    additionalTotal: row.additional_total,
    packageTotal: row.package_total,
    shippingTotal: row.shipping_total,
    storageTotal: row.storage_total,
    returnPostageTotal: row.returnpostage_total,
    returnProcessingTotal: row.returnprocessing_total,
    rowTotal: row.row_total,
  }));
}

/** Total per-order rows for a details query — powers the drill-in pagination. */
export async function portalInvoiceDetailCount(
  scope: ClientPortalScope,
  input: { clientId?: number | null; dateFrom: string; dateTo: string },
): Promise<number> {
  if (input.clientId) {
    const [client] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(clientFilterPredicate(scope, input.clientId, null))
      .limit(1);
    if (client?.name === HERITAGE_PREP_FEE_CLIENT_NAME) {
      const overrideRows = heritagePrepFeeRowsForRange(input.dateFrom, billingDayBefore(input.dateTo) ?? input.dateTo);
      if (overrideRows.length > 0) return overrideRows.length;
    }
  }
  const rows = await db.execute<{ count: string }>(sql`
    select count(*)::text as count from (
      select 1
      from billing_line_items b
      left join ${clients} c on c.id = b.client_id
      where coalesce(c.active, true) = true
        and ${invoiceEffectiveDay} >= ${input.dateFrom}::timestamptz
        and ${invoiceEffectiveDay} < ${input.dateTo}::timestamptz
        ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
        ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
      group by b.client_id, c.name, b.order_id, b.order_number
    ) t
  `);
  return Number(rows[0]?.count) || 0;
}

type PortalInvoicePeriodSummaryRow = {
  client_id: number;
  client_name: string | null;
  month_start: string;
  half: string;
  orders: string;
  pickpack_total: string;
  additional_total: string;
  package_total: string;
  shipping_total: string;
  storage_total: string;
  returnpostage_total: string;
  returnprocessing_total: string;
  row_total: string;
};

/**
 * Per-client billing-period rollup: one row per client per period. Default
 * granularity is SEMI-MONTHLY (1st–15th and 16th–end of month); 'month'
 * combines both halves into one full-month row (1st–EOM). UTC effective-day
 * boundaries — the same boundaries the range filters use. SQL-aggregated,
 * no row cap.
 */
export async function portalInvoicePeriodSummary(
  scope: ClientPortalScope,
  input: { clientId?: number | null; dateFrom: string; dateTo: string; granularity?: 'half' | 'month' },
) {
  const halfExpr =
    input.granularity === 'month'
      ? sql`'0'`
      : sql`(case when extract(day from ${invoiceEffectiveDay} at time zone 'UTC') <= 15 then 1 else 2 end)::text`;
  const rows = await db.execute<PortalInvoicePeriodSummaryRow>(sql`
    select
      b.client_id,
      c.name as client_name,
      to_char(date_trunc('month', ${invoiceEffectiveDay} at time zone 'UTC'), 'YYYY-MM-DD') as month_start,
      ${halfExpr} as half,
      count(distinct b.order_id)::text as orders,
      coalesce(sum(case when b.line_type in ('pick_pack', 'pickpack') then b.total_cost else 0 end), 0)::text as pickpack_total,
      coalesce(sum(case when b.line_type in ('additional_unit', 'additional') then b.total_cost else 0 end), 0)::text as additional_total,
      coalesce(sum(case when b.line_type in ('package_cost', 'package') then b.total_cost else 0 end), 0)::text as package_total,
      coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)::text as shipping_total,
      coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end), 0)::text as storage_total,
      coalesce(sum(case when b.line_type = 'return_postage' then b.total_cost else 0 end), 0)::text as returnpostage_total,
      coalesce(sum(case when b.line_type = 'return_processing_fee' then b.total_cost else 0 end), 0)::text as returnprocessing_total,
      coalesce(sum(b.total_cost), 0)::text as row_total
    from billing_line_items b
    left join ${clients} c on c.id = b.client_id
    where coalesce(c.active, true) = true
      and ${invoiceEffectiveDay} >= ${input.dateFrom}::timestamptz
      and ${invoiceEffectiveDay} < ${input.dateTo}::timestamptz
      ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
      ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
    group by b.client_id, c.name, 3, 4
    order by 3 desc, 4 desc, sum(b.total_cost) desc
  `);
  return rows.map((row) => {
    const monthPrefix = row.month_start.slice(0, 8); // 'YYYY-MM-'
    const year = Number(row.month_start.slice(0, 4));
    const month = Number(row.month_start.slice(5, 7));
    const half = Number(row.half); // 0 = full month, 1 = 1st–15th, 2 = 16th–EOM
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      clientId: row.client_id,
      clientName: row.client_name,
      periodStart: half === 2 ? `${monthPrefix}16` : `${monthPrefix}01`,
      periodEnd: half === 1 ? `${monthPrefix}15` : `${monthPrefix}${String(lastDay).padStart(2, '0')}`,
      orders: Number(row.orders) || 0,
      pickpackTotal: row.pickpack_total,
      additionalTotal: row.additional_total,
      packageTotal: row.package_total,
      shippingTotal: row.shipping_total,
      storageTotal: row.storage_total,
      returnPostageTotal: row.returnpostage_total,
      returnProcessingTotal: row.returnprocessing_total,
      rowTotal: row.row_total,
    };
  });
}

// CP-016: whitelisted server-side sort for the Billing line-item table. The
// query owns sorting the FULL filtered set before limit/offset, so header
// sorting spans every page (not just the loaded one). Each key maps to the same
// canonical grouped expression the SELECT uses; unknown keys fall back to the
// default (never interpolate raw client params into SQL). `order_id` is unique
// per group, so it is the deterministic tie-breaker for stable pagination.
const INVOICE_DETAIL_SORT_EXPR: Record<string, SQL> = {
  order: sql`case when b.order_number ~ '^[0-9]+$' then lpad(b.order_number, 20, '0') else lower(coalesce(b.order_number, '')) end`,
  date: sql`min(${invoiceEffectiveDay})`,
  item: sql`lower(coalesce(${invoiceItemNameLinesSql(sql`b.order_id`)}, ''))`,
  sku: sql`(select min(lower(oi.sku)) from ${orderItems} oi where oi.order_id = b.order_id and oi.sku is not null and oi.sku <> '')`,
  qty: sql`coalesce((select sum(greatest(0, coalesce(oi.quantity, 0))) from ${orderItems} oi where oi.order_id = b.order_id and oi.quantity > 0 and coalesce(oi.unit_price, 0) >= 0), 0)`,
  pickpack: sql`coalesce(sum(case when b.line_type in ('pick_pack', 'pickpack') then b.total_cost else 0 end), 0)`,
  addl: sql`coalesce(sum(case when b.line_type in ('additional_unit', 'additional') then b.total_cost else 0 end), 0)`,
  boxcost: sql`coalesce(sum(case when b.line_type in ('package_cost', 'package') then b.total_cost else 0 end), 0)`,
  boxsize: sql`max(oo.best_rate_dims)`,
  shipping: sql`coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)`,
  fee: sql`coalesce(sum(b.total_cost), 0)`,
};

export const INVOICE_DETAIL_SORT_KEYS = Object.keys(INVOICE_DETAIL_SORT_EXPR);

/** ORDER BY for the Billing detail query: the whitelisted column (asc/desc)
 *  first, then a unique per-group tie-breaker. Unknown/absent key → default
 *  effective billing-day order (the same order the printable invoice/export use). */
function invoiceDetailOrderBy(sortBy?: string | null, sortDir?: string | null): SQL {
  const expr = sortBy ? INVOICE_DETAIL_SORT_EXPR[sortBy] : undefined;
  if (!expr) return sql`order by min(${invoiceEffectiveDay}) desc, b.order_id desc`;
  const dir = String(sortDir).toLowerCase() === 'asc' ? sql`asc` : sql`desc`;
  return sql`order by ${expr} ${dir} nulls last, b.order_id desc`;
}

/** Sort the Heritage Prep Fee override rows the same way the SQL path sorts —
 *  in full, before pagination slices — so that special client's Billing table
 *  also sorts across all pages. Mutates + returns the array. */
function sortHeritageOverrideRows<T extends {
  orderNumber: string | null;
  itemNames: string | null;
  shipDate: string | null;
  qty: number;
  pickpackTotal: number;
  packageTotal: number;
  shippingTotal: number;
  rowTotal: number;
}>(rows: T[], sortBy?: string | null, sortDir?: string | null): T[] {
  if (!sortBy || !(sortBy in INVOICE_DETAIL_SORT_EXPR)) return rows;
  const sign = String(sortDir).toLowerCase() === 'asc' ? 1 : -1;
  const num = (r: T): number =>
    sortBy === 'qty' ? r.qty
    : sortBy === 'pickpack' ? r.pickpackTotal
    : sortBy === 'boxcost' ? r.packageTotal
    : sortBy === 'shipping' ? r.shippingTotal
    : sortBy === 'fee' ? r.rowTotal
    : sortBy === 'addl' ? 0
    : NaN;
  const text = (r: T): string | null =>
    sortBy === 'order' ? r.orderNumber
    : sortBy === 'item' ? r.itemNames
    : sortBy === 'date' ? r.shipDate
    : null;
  return rows.sort((a, b) => {
    const na = num(a);
    if (Number.isFinite(na)) return (na - num(b)) * sign;
    const ta = text(a);
    const tb = text(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' }) * sign;
  });
}

type PortalInvoiceDetailRow = {
  client_id: number;
  client_name: string | null;
  order_id: number | null;
  order_number: string | null;
  recipient_name: string | null;
  item_names: string | null;
  items_json: string | null;
  skus: string | null;
  best_rate_dims: string | null;
  dim_l: string | null;
  dim_w: string | null;
  dim_h: string | null;
  ship_date: string | null;
  billing_effective_date: string | null;
  billing_policy_version: string | null;
  rolled_from_weekend: boolean;
  qty: string;
  pickpack_total: string;
  additional_total: string;
  package_total: string;
  shipping_total: string;
  storage_total: string;
  returnpostage_total: string;
  returnprocessing_total: string;
  row_total: string;
};

export async function portalInvoiceDetails(
  scope: ClientPortalScope,
  input: {
    clientId?: number | null;
    dateFrom: string;
    dateTo: string;
    page?: number;
    pageSize?: number;
    // CP-016: whitelisted server-side sort applied across the full filtered set
    // before pagination. See INVOICE_DETAIL_SORT_KEYS.
    sortBy?: string | null;
    sortDir?: string | null;
  },
) {
  if (input.clientId) {
    const [client] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(clientFilterPredicate(scope, input.clientId, null))
      .limit(1);
    if (client?.name === HERITAGE_PREP_FEE_CLIENT_NAME) {
      // CP-016: sort the FULL override set before slicing this page.
      const allOverrideRows = sortHeritageOverrideRows(
        heritagePrepFeeRowsForRange(input.dateFrom, billingDayBefore(input.dateTo) ?? input.dateTo),
        input.sortBy,
        input.sortDir,
      );
      const overrideRows =
        input.page && input.pageSize
          ? allOverrideRows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
          : allOverrideRows;
      if (allOverrideRows.length > 0) {
        return overrideRows.map((row) => ({
          clientId: client.id,
          clientName: client.name,
          orderId: null,
          orderNumber: row.orderNumber,
          recipientName: row.recipientName,
          itemNames: row.itemNames,
          items: [] as ReturnType<typeof safeItems>,
          skus: null,
          carrierCode: null,
          boxSize: null,
          shipDate: row.shipDate,
          actualActivityDate: row.shipDate,
          billingEffectiveDate: row.shipDate,
          billingPolicyVersion: null,
          rolledFromWeekend: false,
          qty: row.qty.toFixed(3),
          pickpackTotal: row.pickpackTotal.toFixed(2),
          additionalTotal: '0.00',
          packageTotal: row.packageTotal.toFixed(2),
          shippingTotal: row.shippingTotal.toFixed(2),
          storageTotal: row.storageTotal.toFixed(2),
          // Heritage prep-fee override rows carry no return charges.
          returnPostageTotal: '0.00',
          returnProcessingTotal: '0.00',
          rowTotal: row.rowTotal.toFixed(2),
        }));
      }
    }
  }

  const rows = await db.execute<PortalInvoiceDetailRow>(sql`
    select
      b.client_id,
      c.name as client_name,
      b.order_id,
      b.order_number,
      max(o.ship_to_name) as recipient_name,
      ${invoiceItemNameLinesSql(sql`b.order_id`)} as item_names,
      max(o.items::text) as items_json,
      (
        select string_agg(distinct oi.sku, ', ')
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.sku is not null
          and oi.sku <> ''
      ) as skus,
      max(oo.best_rate_dims) as best_rate_dims,
      max(o.raw->'dimensions'->>'length') as dim_l,
      max(o.raw->'dimensions'->>'width') as dim_w,
      max(o.raw->'dimensions'->>'height') as dim_h,
      to_char(min(b.ship_date) at time zone 'UTC', 'YYYY-MM-DD') as ship_date,
      to_char(min(${invoiceEffectiveDay}) at time zone 'UTC', 'YYYY-MM-DD') as billing_effective_date,
      max(b.billing_policy_version) as billing_policy_version,
      bool_or(
        b.billing_policy_version = ${BILLING_POLICY_WEEKEND_ROLLFORWARD}
        and b.ship_date is distinct from ${invoiceEffectiveDay}
      ) as rolled_from_weekend,
      coalesce((
        select sum(greatest(0, coalesce(oi.quantity, 0)))
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.quantity > 0
          and coalesce(oi.unit_price, 0) >= 0
      ), 0)::text as qty,
      coalesce(sum(case when b.line_type in ('pick_pack', 'pickpack') then b.total_cost else 0 end), 0)::text as pickpack_total,
      coalesce(sum(case when b.line_type in ('additional_unit', 'additional') then b.total_cost else 0 end), 0)::text as additional_total,
      coalesce(sum(case when b.line_type in ('package_cost', 'package') then b.total_cost else 0 end), 0)::text as package_total,
      coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)::text as shipping_total,
      coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end), 0)::text as storage_total,
      coalesce(sum(case when b.line_type = 'return_postage' then b.total_cost else 0 end), 0)::text as returnpostage_total,
      coalesce(sum(case when b.line_type = 'return_processing_fee' then b.total_cost else 0 end), 0)::text as returnprocessing_total,
      coalesce(sum(b.total_cost), 0)::text as row_total
    from billing_line_items b
    left join ${clients} c on c.id = b.client_id
    left join ${orders} o on o.id = b.order_id
    left join ${orderOverrides} oo on oo.order_id = b.order_id
    where coalesce(c.active, true) = true
      and ${invoiceEffectiveDay} >= ${input.dateFrom}::timestamptz
      and ${invoiceEffectiveDay} < ${input.dateTo}::timestamptz
      ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
      ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
    group by b.client_id, c.name, b.order_id, b.order_number
    ${invoiceDetailOrderBy(input.sortBy, input.sortDir)}
    limit ${input.pageSize ?? (input.clientId ? 5000 : 1000)}
    ${input.page && input.pageSize ? sql`offset ${(input.page - 1) * input.pageSize}` : sql``}
  `);

  const dimsFromRaw = (l: string | null, w: string | null, h: string | null): string | null => {
    const nl = Number(l);
    const nw = Number(w);
    const nh = Number(h);
    if ([nl, nw, nh].every((n) => Number.isFinite(n) && n > 0)) return `${nl}x${nw}x${nh}`;
    return null;
  };

  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    orderId: row.order_id,
    orderNumber: row.order_number,
    recipientName: row.recipient_name,
    itemNames: row.item_names,
    items: safeItems(parseItemsJson(row.items_json), scope.canViewFinancials),
    skus: row.skus,
    // CP-018: the client portal never exposes the carrier — not even on the wire.
    // (Matches the heritage-override branch above, which already hardcodes null.)
    carrierCode: null,
    boxSize: row.best_rate_dims ?? dimsFromRaw(row.dim_l, row.dim_w, row.dim_h),
    shipDate: row.ship_date,
    actualActivityDate: row.ship_date,
    billingEffectiveDate: row.billing_effective_date ?? row.ship_date,
    billingPolicyVersion: row.billing_policy_version,
    rolledFromWeekend: row.rolled_from_weekend === true,
    qty: row.qty,
    pickpackTotal: row.pickpack_total,
    additionalTotal: row.additional_total,
    packageTotal: row.package_total,
    shippingTotal: row.shipping_total,
    storageTotal: row.storage_total,
    returnPostageTotal: row.returnpostage_total,
    returnProcessingTotal: row.returnprocessing_total,
    rowTotal: row.row_total,
  }));
}

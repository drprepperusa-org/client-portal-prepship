// READ-ONLY analytics helper. Returns the per-SKU "Recent Orders" payload
// consumed by the client-portal Analysis page SKU detail drawer. (The operator
// Inventory drawer uses a separate skuOrdersAnalytics service; post-CP-038 this
// helper's only live caller is the client portal, which passes
// shippingBasis: 'customer_billed' — the 'house_markup' default is retained but
// has no live caller.) This file only SELECTs from orders / order_items /
// shipments / billing_line_items — it never writes, so it is safe under the
// shipped/cancelled data lockdown (analytics reads are explicitly allowed).
//
// CP-060: shipping money is classified PER SHIPMENT. Every eligible label is
// classified standard/expedited by its own service code and carries its own
// customer shipping money. The pre-CP-060 model classified the ENTIRE
// order-grain sum by the newest label's service, which misclassified mixed
// standard/expedited multi-label orders and disagreed with PrepShip's
// per-shipment reporting (PS-418).
//
// CP-060 correction (Hermes 2026-08-21): the money and its class split must
// come from ONE row set. The first cut summed the order total over
// billing_line_items by order_id while summing the class split over shipments,
// so a shipping line pointing at a voided shipment — or at a shipment of a
// different order, which no constraint prevents — was counted in the total,
// excluded from both classes, and still reported as fully 'attributed'.
//
// Both halves now come from the canonical owner: money per shipment is
// shipmentCustomerShippingRateSql() (PrepShip's frozen billing line, falling
// back to its frozen rate snapshot) over the shipments
// shipmentIsCustomerShippingEligibleSql() admits. That is the exact per-shipment
// value orderCustomerShippingRateSql() sums for the Orders surface and the order
// detail charge summary, so the two share ONE unallocated source, and every
// dollar in it belongs to exactly one shipment and therefore exactly one class.
// total = standard + expedited is structural, not an invariant to be checked.
//
// A drawer ROW is a proportional allocation of that source across the order's
// units (× qty / order_qty_total). It does NOT equal the order-detail Shipping
// row unless the SKU owns every unit; what holds is that an order's SKU rows
// SUM to it. An earlier comment here claimed row-level equality — false for
// multi-SKU orders, corrected per Hermes 2026-08-22.
//
// Second correction from the same review: money the canonical resolver does not
// recognise is still money Billing charges. Invoice surfaces sum every
// 'shipping' line by order_id, so an invoice can exceed the eligible-label sum.
// Rather than quietly omitting the difference, the read model detects it and
// reports 'billing_mismatch' — see the inv lateral below.
//
// The query is parametrized by `orderScopeSql`: a raw predicate against the
// orders table aliased as `o`. Callers pass their own tenant scope (operator
// vs. client-portal) so visibility rules stay owned by the route, not here.
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import {
  eligibleShipmentMoneyLateralSql,
  hasOutboundShipmentLateralSql,
  invoicedShippingLateralSql,
  moneyColumnsSql,
  shippingMoneyStateCaseSql,
} from '../lib/client-portal/shipping-analysis-sql';
import { walmartDirectDuplicateSuppressionPredicate } from '../lib/walmart-order-dedupe';

/**
 * Why the order has, or has not, a shipping figure.
 *
 * - `attributed`    — the canonical resolver returned a value; total = std + exp.
 * - `billing_mismatch` — the order carries shipping money the canonical resolver
 *                     cannot account for: either a line of abnormal lineage
 *                     exists (unattached, foreign-linked, voided/return-linked)
 *                     in EITHER direction, or Billing simply charges more than
 *                     the eligible labels resolve to. The row shows the INVOICED
 *                     figure (they are charged it) with no class split, and is
 *                     excluded from the class averages. Never let this render as
 *                     a clean `attributed`: a display resolver cannot make
 *                     charged money stop being customer money by declining to
 *                     look at it — and a NEGATIVE abnormal line overstates the
 *                     customer's bill just as surely as a positive one hides it.
 * - `pending`       — an eligible label exists but PrepShip has neither billed it
 *                     nor frozen a rate snapshot yet. Mirrors the Orders surface's
 *                     `customerShippingRatePending`; never call this "unbilled",
 *                     which the order detail page would immediately contradict.
 * - `external_label`— shipped with no PrepShip shipment at all.
 * - `voided_only`   — shipments exist, none eligible.
 *
 * The pre-correction `partial_unattributed` / `unattributed_legacy` states are
 * gone: with one row set there is no residual to describe. `unbilled` is renamed
 * `pending` for the reason above.
 */
export type ShippingMoneyState =
  | 'attributed'
  | 'billing_mismatch'
  | 'pending'
  | 'external_label'
  | 'voided_only';

export type SkuOrderRow = {
  order_id: number;
  order_number: string;
  order_date: string | null;
  order_status: string;
  ship_to_name: string | null;
  carrier_code: string | null;
  service_code: string | null;
  qty: number;
  unit_price: string | null;
  item_name: string | null;
  shipping_cost: string | null;
  shipping_total: string | null;
  /** On `billing_mismatch`, what the eligible labels DID resolve to; else null. */
  shipping_reconciled: string | null;
  shipping_standard: string | null;
  shipping_expedited: string | null;
  shipping_money_state: ShippingMoneyState;
  is_external_shipped: boolean;
};

export type SkuOrdersResult = {
  sku: string;
  name: string | null;
  clientId: number | null;
  totalUnits: number;
  shipCountStandard: number;
  shipCountExpedited: number;
  shippingStandardTotal: string;
  shippingExpeditedTotal: string;
  avgShippingStandard: string;
  avgShippingExpedited: string;
  dailySales: Array<{ day: string; units: number }>;
  orders: SkuOrderRow[];
};

export type SkuOrdersInput = {
  sku: string;
  name?: string | null;
  clientId?: number | null;
  // ISO timestamps; when omitted falls back to a rolling `days` window.
  dateFrom?: string | null;
  dateTo?: string | null;
  days?: number | null;
  canViewFinancials: boolean;
  // Raw predicate against the orders table aliased `o`. Undefined = no extra
  // tenant restriction (caller already trusts the full set).
  orderScopeSql?: SQL;
  // CP-038: 'house_markup' (default, operator/legacy inline markup) or 'customer_billed'
  // (client portal — canonical billing_line_items shipping).
  shippingBasis?: 'house_markup' | 'customer_billed';
};

export async function getSkuOrdersForSku(input: SkuOrdersInput): Promise<SkuOrdersResult> {
  const { sku, canViewFinancials } = input;
  const customerBilled = input.shippingBasis === 'customer_billed';
  const since = input.dateFrom
    ? new Date(input.dateFrom).toISOString()
    : input.days
      ? new Date(Date.now() - input.days * 24 * 60 * 60 * 1000).toISOString()
      : null;
  const until = input.dateTo ? new Date(input.dateTo).toISOString() : null;

  const dateFilterSql = sql`
    ${since ? sql`and o.order_date >= ${since}::timestamptz` : sql``}
    ${until ? sql`and o.order_date <= ${until}::timestamptz` : sql``}
  `;

  // Match the operator route: exclude disabled clients (NULL client_id still
  // passes — lenient), then AND in the caller's tenant scope predicate.
  const activeClientOrderFilter = sql`
    and (
      o.client_id is null
      or exists (
        select 1 from clients c
        where c.id = o.client_id
          and coalesce(c.active, true) = true
      )
    )
    ${input.orderScopeSql ? sql`and ${input.orderScopeSql}` : sql``}
  `;
  const walmartCanonicalOrderFilter = walmartDirectDuplicateSuppressionPredicate('o');

  // Dense daily-units series for the bar chart.
  const dailyRows = since || until
    ? await db.execute<{ day: string; units: number }>(sql`
        select
          to_char(date_trunc('day', o.order_date), 'YYYY-MM-DD') as day,
          sum(oi.quantity)::int                                  as units
        from order_items oi
        join orders o on o.id = oi.order_id
        where lower(oi.sku) = lower(${sku})
          ${dateFilterSql}
          and coalesce(o.order_status, '') <> 'cancelled'
          and oi.quantity > 0
          ${activeClientOrderFilter}
          and ${walmartCanonicalOrderFilter}
        group by date_trunc('day', o.order_date)
        order by date_trunc('day', o.order_date) asc
      `)
    : [];
  const salesMap = new Map(dailyRows.map((r) => [r.day, Number(r.units ?? 0)]));
  const dailySales: { day: string; units: number }[] = [];
  const safeDays = Math.max(1, Math.min(3650, input.days ?? 30));
  const startDay = since ? new Date(since) : new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = until ? new Date(until) : new Date();
  endDay.setUTCHours(0, 0, 0, 0);
  const bucketDays = Math.max(
    1,
    Math.min(3650, Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1)
  );
  for (let i = 0; i < bucketDays; i += 1) {
    const d = new Date(startDay);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    dailySales.push({ day, units: salesMap.get(day) ?? 0 });
  }

  // CP-060 AC-4: the money aggregate, the outbound-shipment probe and the
  // invoiced-shipping reconciliation all come from lib/client-portal/
  // shipping-analysis-sql.ts, which the Analysis TABLE path imports too. One
  // definition, so the drawer and the table cannot drift the way the pre-CP-060
  // order-grain model drifted from the per-shipment one.
  const labelsLateral = sql`
    ${eligibleShipmentMoneyLateralSql()}
    ${hasOutboundShipmentLateralSql()}
    ${invoicedShippingLateralSql()}
  `;

  const moneyColumns = moneyColumnsSql(customerBilled ? 'customer_billed' : 'house_markup');

  const stateCaseSql = shippingMoneyStateCaseSql();

  const [shippingSummary] = await db.execute<{
    std_ship_count: number;
    exp_ship_count: number;
    std_shipping_total: string;
    exp_shipping_total: string;
    avg_std_shipping: string;
    avg_exp_shipping: string;
  }>(sql`
    with matching_order_ids as (
      select distinct o.id
      from order_items oi
      join orders o on o.id = oi.order_id
      where lower(oi.sku) = lower(${sku})
        ${dateFilterSql}
        and coalesce(o.order_status, '') <> 'cancelled'
        and oi.quantity > 0
        ${activeClientOrderFilter}
        and ${walmartCanonicalOrderFilter}
    ),
    item_rows as (
      select
        o.id                                                               as order_id,
        o.order_status                                                     as order_status,
        labels.active_label_count                                          as active_label_count,
        sh.has_any_shipment                                                as has_any_shipment,
        ${moneyColumns}
        oi.sku                                                             as sku,
        oi.sku                                                             as sku_key,
        greatest(0, coalesce(oi.quantity, 0))::int                         as qty
      from matching_order_ids moi
      join orders o on o.id = moi.id
      join order_items oi on oi.order_id = o.id
      ${labelsLateral}
      where oi.quantity > 0
    ),
    order_sku_rows as (
      select
        order_id,
        max(order_status)                                                   as order_status,
        max(active_label_count)                                             as active_label_count,
        bool_or(has_any_shipment)                                           as has_any_shipment,
        max(money_total)                                                    as money_total,
        max(money_std)                                                      as money_std,
        max(money_exp)                                                      as money_exp,
        max(money_invoiced)                                                 as money_invoiced,
        max(money_odd_lines)                                                as money_odd_lines,
        sku_key,
        max(sku)                                                            as sku,
        sum(qty)::int                                                       as qty
      from item_rows
      group by order_id, sku_key
    ),
    allocated as (
      select
        r.*,
        sum(qty) over (partition by r.order_id)::int                        as order_qty_total,
        ${stateCaseSql}                                                     as money_state
      from order_sku_rows r
    ),
    classed as (
      select *,
        (money_state = 'attributed')                                       as attributable
      from allocated
      where lower(sku) = lower(${sku})
    )
    select
      count(*) filter (where attributable and money_std <> 0)::int          as std_ship_count,
      count(*) filter (where attributable and money_exp <> 0)::int          as exp_ship_count,
      coalesce(sum(money_std * qty / nullif(order_qty_total, 0)) filter (
        where attributable and money_std <> 0
      ), 0)::text as std_shipping_total,
      coalesce(sum(money_exp * qty / nullif(order_qty_total, 0)) filter (
        where attributable and money_exp <> 0
      ), 0)::text as exp_shipping_total,
      coalesce(
        sum(money_std * qty / nullif(order_qty_total, 0)) filter (
          where attributable and money_std <> 0
        )
        / nullif(sum(qty) filter (where attributable and money_std <> 0), 0),
        0
      )::text as avg_std_shipping,
      coalesce(
        sum(money_exp * qty / nullif(order_qty_total, 0)) filter (
          where attributable and money_exp <> 0
        )
        / nullif(sum(qty) filter (where attributable and money_exp <> 0), 0),
        0
      )::text as avg_exp_shipping
    from classed
  `);

  const rows = await db.execute<SkuOrderRow>(sql`
    with matching_order_ids as (
      select distinct o.id
      from order_items oi
      join orders o on o.id = oi.order_id
      where lower(oi.sku) = lower(${sku})
        ${dateFilterSql}
        and coalesce(o.order_status, '') <> 'cancelled'
        and oi.quantity > 0
        ${activeClientOrderFilter}
        and ${walmartCanonicalOrderFilter}
    ),
    item_rows as (
      select
        o.id                                                               as order_id,
        o.order_number                                                     as order_number,
        o.order_date                                                       as order_date,
        o.order_status                                                     as order_status,
        o.ship_to_name                                                     as ship_to_name,
        o.carrier_code                                                     as carrier_code,
        coalesce(labels.service_code, o.service_code)                      as service_code,
        labels.active_label_count                                          as active_label_count,
        sh.has_any_shipment                                                as has_any_shipment,
        ${moneyColumns}
        coalesce(o.externally_shipped, false)                              as externally_shipped_flag,
        oi.sku                                                             as sku,
        oi.sku                                                             as sku_key,
        coalesce(nullif(oi.name, ''), '-')                                 as item_name,
        greatest(0, coalesce(oi.quantity, 0))::int                         as qty,
        oi.unit_price::text                                                as unit_price
      from matching_order_ids moi
      join orders o on o.id = moi.id
      join order_items oi on oi.order_id = o.id
      ${labelsLateral}
      where oi.quantity > 0
    ),
    order_sku_rows as (
      select
        order_id,
        max(order_number)                                                   as order_number,
        min(order_date)                                                     as order_date,
        max(order_status)                                                   as order_status,
        max(ship_to_name)                                                   as ship_to_name,
        max(carrier_code)                                                   as carrier_code,
        max(service_code)                                                   as service_code,
        max(active_label_count)                                             as active_label_count,
        bool_or(has_any_shipment)                                           as has_any_shipment,
        max(money_total)                                                    as money_total,
        max(money_std)                                                      as money_std,
        max(money_exp)                                                      as money_exp,
        max(money_invoiced)                                                 as money_invoiced,
        max(money_odd_lines)                                                as money_odd_lines,
        bool_or(externally_shipped_flag)                                    as externally_shipped_flag,
        sku_key,
        max(sku)                                                            as sku,
        (array_agg(item_name order by length(item_name) desc))[1]           as item_name,
        sum(qty)::int                                                       as qty,
        max(unit_price)                                                     as unit_price
      from item_rows
      group by order_id, sku_key
    ),
    allocated as (
      select
        r.*,
        sum(qty) over (partition by r.order_id)::int                        as order_qty_total,
        ${stateCaseSql}                                                     as money_state
      from order_sku_rows r
    )
    select
      order_id,
      order_number,
      order_date,
      order_status,
      ship_to_name,
      carrier_code,
      service_code,
      qty,
      unit_price,
      item_name,
      case
        when money_state = 'attributed'
          then (money_total / nullif(order_qty_total, 0))::text
        when money_state = 'billing_mismatch'
          then (money_invoiced / nullif(order_qty_total, 0))::text
        else null
      end as shipping_cost,
      -- On a mismatch this is the INVOICED figure, not the resolver's. The
      -- customer is charged it; hiding it behind a caption would be the same
      -- omission this correction exists to remove. shipping_money_state says
      -- which of the two definitions produced the number, and the class split
      -- is withheld because unattributable money has no honest class.
      case
        when money_state = 'attributed'
          then (money_total * qty / nullif(order_qty_total, 0))::text
        when money_state = 'billing_mismatch'
          then (money_invoiced * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_total,
      case
        when money_state = 'billing_mismatch'
          then (money_total * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_reconciled,
      case
        when money_state = 'attributed' and money_std <> 0
          then (money_std * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_standard,
      case
        when money_state = 'attributed' and money_exp <> 0
          then (money_exp * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_expedited,
      money_state                                                          as shipping_money_state,
      (money_state = 'external_label' or externally_shipped_flag)          as is_external_shipped
    from allocated
    where lower(sku) = lower(${sku})
    order by order_date desc nulls last
    limit 200
  `);

  const visibleShippingSummary = canViewFinancials ? shippingSummary : null;
  const visibleRows = canViewFinancials
    ? rows
    : rows.map((orderRow) => ({
        ...orderRow,
        shipping_cost: null,
        shipping_total: null,
        shipping_standard: null,
        shipping_expedited: null,
        shipping_reconciled: null,
      }));

  return {
    sku,
    name: input.name ?? null,
    clientId: input.clientId ?? null,
    totalUnits: dailySales.reduce((sum, r) => sum + r.units, 0),
    shipCountStandard: visibleShippingSummary?.std_ship_count ?? 0,
    shipCountExpedited: visibleShippingSummary?.exp_ship_count ?? 0,
    shippingStandardTotal: visibleShippingSummary?.std_shipping_total ?? '0',
    shippingExpeditedTotal: visibleShippingSummary?.exp_shipping_total ?? '0',
    avgShippingStandard: visibleShippingSummary?.avg_std_shipping ?? '0',
    avgShippingExpedited: visibleShippingSummary?.avg_exp_shipping ?? '0',
    dailySales,
    orders: visibleRows,
  };
}

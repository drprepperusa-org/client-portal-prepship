// READ-ONLY analytics helper. Returns the per-SKU "Recent Orders" payload
// consumed by the client-portal Analysis page SKU detail drawer. (The operator
// Inventory drawer uses a separate skuOrdersAnalytics service; post-CP-038 this
// helper's only live caller is the client portal, which passes
// shippingBasis: 'customer_billed' — the 'house_markup' default is retained but
// has no live caller.) This file only SELECTs from orders / order_items /
// shipments / billing_line_items — it never writes, so it is safe under the
// shipped/cancelled data lockdown (analytics reads are explicitly allowed).
//
// CP-060: shipping money is classified PER SHIPMENT. Every non-voided label is
// classified standard/expedited by its own service code and carries its own
// billed money via billing_line_items.shipment_id. Money that cannot be
// attributed to a label (legacy lines with shipment_id NULL, voided-only or
// external orders) is never given a class — it surfaces through an explicit
// shipping_money_state instead. The pre-CP-060 model classified the ENTIRE
// order-grain sum by the newest label's service, which misclassified mixed
// standard/expedited multi-label orders and disagreed with PrepShip's
// per-shipment reporting (PS-418).
//
// The query is parametrized by `orderScopeSql`: a raw predicate against the
// orders table aliased as `o`. Callers pass their own tenant scope (operator
// vs. client-portal) so visibility rules stay owned by the route, not here.
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { EXPEDITED_SERVICES_SQL } from '../lib/shipping-class';
import { walmartDirectDuplicateSuppressionPredicate } from '../lib/walmart-order-dedupe';

export type ShippingMoneyState =
  | 'attributed'
  | 'partial_unattributed'
  | 'unattributed_legacy'
  | 'unbilled'
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

  // CP-060 per-shipment money aggregate. One row per order:
  //   - every NON-VOIDED label classified by ITS OWN service code
  //   - customer money joined per label via billing_line_items.shipment_id
  //   - house money computed per label with the same markup model as before
  // Voided labels contribute nothing — including to classification, so a
  // voided newest label can no longer classify the whole order.
  const labelsLateral = sql`
    left join lateral (
      select
        count(*)::int                                                       as active_label_count,
        max(s.service_code)                                                 as service_code,
        coalesce(sum(billed.amount) filter (where cls.is_exp), 0)::numeric  as exp_billed,
        coalesce(sum(billed.amount) filter (where not cls.is_exp), 0)::numeric as std_billed,
        coalesce(sum(billed.amount), 0)::numeric                            as attributed_billed,
        coalesce(sum(house.amount) filter (where cls.is_exp), 0)::numeric   as exp_house,
        coalesce(sum(house.amount) filter (where not cls.is_exp), 0)::numeric as std_house,
        coalesce(sum(house.amount), 0)::numeric                             as house_billed
      from shipments s
      left join lateral (
        select sum(b.total_cost)::numeric as amount
        from billing_line_items b
        where b.shipment_id = s.id and b.line_type = 'shipping'
      ) billed on true
      left join settings pid_markup
        on pid_markup.key = 'markup.' || coalesce(s.provider_account_id, s.label_provider, s.selected_pid)::text
      left join settings carrier_markup
        on carrier_markup.key in ('markup.' || s.carrier_code, 'markup.' || lower(s.carrier_code))
      cross join lateral (
        select
          (coalesce(s.cost, s.label_cost, 0) + coalesce(s.other_cost, 0))::numeric as base_cost,
          case
            when coalesce(pid_markup.value, carrier_markup.value) ~ '^\\s*\\{'
              then coalesce(pid_markup.value, carrier_markup.value)::jsonb
            else null::jsonb
          end as markup
      ) cost_model
      cross join lateral (
        select case
          when lower(cost_model.markup->>'type') in ('pct', 'percent')
            then cost_model.base_cost * (1 + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0) / 100)
          when lower(cost_model.markup->>'type') in ('amount', 'flat')
            then cost_model.base_cost + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0)
          else cost_model.base_cost
        end as amount
      ) house
      cross join lateral (
        select lower(coalesce(s.service_code, '')) = ANY(${EXPEDITED_SERVICES_SQL}) as is_exp
      ) cls
      where s.order_id = o.id
        and coalesce(s.voided, false) = false
    ) labels on true
    left join lateral (
      select
        coalesce(sum(b.total_cost), 0)::numeric                             as order_billed,
        count(*) filter (where b.shipment_id is null)::int                  as unattributed_lines
      from billing_line_items b
      where b.order_id = o.id and b.line_type = 'shipping'
    ) ob on true
    cross join lateral (
      select exists (select 1 from shipments s2 where s2.order_id = o.id) as has_any_shipment
    ) sh
  `;

  // Basis switch. customer_billed: order total is the canonical billed sum and
  // class money is only what attributes to a label. house_markup: per-label
  // marked cost is both the total and the attributed money (no legacy lines).
  const moneyColumns = customerBilled
    ? sql`
        ob.order_billed                                                    as money_total,
        labels.std_billed                                                  as money_std,
        labels.exp_billed                                                  as money_exp,
        labels.attributed_billed                                           as money_attributed,
        ob.unattributed_lines                                              as money_unattr_lines,
      `
    : sql`
        labels.house_billed                                                as money_total,
        labels.std_house                                                   as money_std,
        labels.exp_house                                                   as money_exp,
        labels.house_billed                                                as money_attributed,
        0::int                                                             as money_unattr_lines,
      `;

  const stateCaseSql = sql`
    case
      when coalesce(r.active_label_count, 0) = 0 and not r.has_any_shipment
           and r.order_status = 'shipped' then 'external_label'
      when coalesce(r.active_label_count, 0) = 0 and r.has_any_shipment then 'voided_only'
      when coalesce(r.money_total, 0) <= 0 then 'unbilled'
      when coalesce(r.money_unattr_lines, 0) = 0 then 'attributed'
      when coalesce(r.money_attributed, 0) > 0 then 'partial_unattributed'
      else 'unattributed_legacy'
    end
  `;

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
        max(money_attributed)                                               as money_attributed,
        max(money_unattr_lines)                                             as money_unattr_lines,
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
        (money_state in ('attributed', 'partial_unattributed'))            as attributable
      from allocated
      where lower(sku) = lower(${sku})
    )
    select
      count(*) filter (where attributable and money_std > 0)::int          as std_ship_count,
      count(*) filter (where attributable and money_exp > 0)::int          as exp_ship_count,
      coalesce(sum(money_std * qty / nullif(order_qty_total, 0)) filter (
        where attributable and money_std > 0
      ), 0)::text as std_shipping_total,
      coalesce(sum(money_exp * qty / nullif(order_qty_total, 0)) filter (
        where attributable and money_exp > 0
      ), 0)::text as exp_shipping_total,
      coalesce(
        sum(money_std * qty / nullif(order_qty_total, 0)) filter (
          where attributable and money_std > 0
        )
        / nullif(sum(qty) filter (where attributable and money_std > 0), 0),
        0
      )::text as avg_std_shipping,
      coalesce(
        sum(money_exp * qty / nullif(order_qty_total, 0)) filter (
          where attributable and money_exp > 0
        )
        / nullif(sum(qty) filter (where attributable and money_exp > 0), 0),
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
        max(money_attributed)                                               as money_attributed,
        max(money_unattr_lines)                                             as money_unattr_lines,
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
        when money_state in ('attributed', 'partial_unattributed', 'unattributed_legacy')
             and money_total > 0
          then (money_total / nullif(order_qty_total, 0))::text
        else null
      end as shipping_cost,
      case
        when money_state in ('attributed', 'partial_unattributed', 'unattributed_legacy')
             and money_total > 0
          then (money_total * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_total,
      case
        when money_state in ('attributed', 'partial_unattributed') and money_std > 0
          then (money_std * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_standard,
      case
        when money_state in ('attributed', 'partial_unattributed') and money_exp > 0
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

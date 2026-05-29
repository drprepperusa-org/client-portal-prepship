// READ-ONLY analytics helper. Returns the per-SKU "Recent Orders" payload
// used by the SKU detail drawer on both the operator Inventory view and the
// client-portal Analysis page. This file only SELECTs from orders / order_items
// / shipments — it never writes, so it is safe under the shipped/cancelled
// data lockdown (analytics reads are explicitly allowed).
//
// The query is parametrized by `orderScopeSql`: a raw predicate against the
// orders table aliased as `o`. Callers pass their own tenant scope (operator
// vs. client-portal) so visibility rules stay owned by the route, not here.
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { EXPEDITED_SERVICES_SQL } from '../routes/analysis';
import { walmartDirectDuplicateSuppressionPredicate } from '../lib/walmart-order-dedupe';

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
  standard_shipping_cost: string | null;
  standard_shipping_total: string | null;
  is_external_shipped: boolean;
};

export type SkuOrdersResult = {
  sku: string;
  name: string | null;
  clientId: number | null;
  totalUnits: number;
  standardShipCount: number;
  standardShippingTotal: string;
  avgStandardShippingCost: string;
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
};

export async function getSkuOrdersForSku(input: SkuOrdersInput): Promise<SkuOrdersResult> {
  const { sku, canViewFinancials } = input;
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

  const [shippingSummary] = await db.execute<{
    standard_ship_count: number;
    standard_shipping_total: string;
    avg_standard_shipping_cost: string;
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
        coalesce(ls.service_code, o.service_code)                          as service_code,
        ls.order_id                                                        as shipment_order_id,
        coalesce(ls.marked_cost, 0)                                        as label_cost,
        oi.sku                                                             as sku,
        oi.sku                                                             as sku_key,
        coalesce(nullif(oi.name, ''), '-')                                 as name,
        greatest(0, coalesce(oi.quantity, 0))::int                         as qty
      from matching_order_ids moi
      join orders o on o.id = moi.id
      join order_items oi on oi.order_id = o.id
      left join lateral (
        select
          s.order_id,
          s.service_code,
          case
            when lower(cost_model.markup->>'type') in ('pct', 'percent')
              then cost_model.base_cost * (1 + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0) / 100)
            when lower(cost_model.markup->>'type') in ('amount', 'flat')
              then cost_model.base_cost + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0)
            else cost_model.base_cost
          end as marked_cost
        from shipments s
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
        where s.order_id = o.id
          and coalesce(s.voided, false) = false
        order by s.id desc
        limit 1
      ) ls on true
      where oi.quantity > 0
    ),
    order_sku_rows as (
      select
        order_id,
        max(order_status)                                                   as order_status,
        max(service_code)                                                    as service_code,
        max(shipment_order_id)                                               as shipment_order_id,
        max(label_cost)                                                      as label_cost,
        sku_key,
        max(sku)                                                             as sku,
        sum(qty)::int                                                        as qty
      from item_rows
      group by order_id, sku_key
    ),
    allocated as (
      select
        r.*,
        sum(qty) over (partition by r.order_id)::int                         as order_qty_total,
        case
          when r.order_status = 'shipped' and r.shipment_order_id is null then true
          else false
        end                                                                 as is_external,
        case
          when lower(coalesce(r.service_code, '')) = ANY(${EXPEDITED_SERVICES_SQL})
            then 'exp'
          else 'std'
        end                                                                 as ship_class
      from order_sku_rows r
    )
    select
      count(*) filter (
        where lower(sku) = lower(${sku})
          and not is_external
          and label_cost > 0
          and ship_class = 'std'
      )::int as standard_ship_count,
      coalesce(sum(label_cost * qty / nullif(order_qty_total, 0)) filter (
        where lower(sku) = lower(${sku})
          and not is_external
          and label_cost > 0
          and ship_class = 'std'
      ), 0)::text as standard_shipping_total,
      coalesce(
        sum(label_cost * qty / nullif(order_qty_total, 0)) filter (
          where lower(sku) = lower(${sku})
            and not is_external
            and label_cost > 0
            and ship_class = 'std'
        )
        / nullif(sum(qty) filter (
          where lower(sku) = lower(${sku})
            and not is_external
            and label_cost > 0
            and ship_class = 'std'
        ), 0),
        0
      )::text as avg_standard_shipping_cost
    from allocated
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
        coalesce(ls.service_code, o.service_code)                          as service_code,
        ls.order_id                                                        as shipment_order_id,
        coalesce(ls.marked_cost, 0)                                        as label_cost,
        coalesce(o.externally_shipped, false)                              as externally_shipped_flag,
        oi.sku                                                             as sku,
        oi.sku                                                             as sku_key,
        coalesce(nullif(oi.name, ''), '-')                                 as item_name,
        greatest(0, coalesce(oi.quantity, 0))::int                         as qty,
        oi.unit_price::text                                                as unit_price
      from matching_order_ids moi
      join orders o on o.id = moi.id
      join order_items oi on oi.order_id = o.id
      left join lateral (
        select
          s.order_id,
          s.service_code,
          case
            when lower(cost_model.markup->>'type') in ('pct', 'percent')
              then cost_model.base_cost * (1 + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0) / 100)
            when lower(cost_model.markup->>'type') in ('amount', 'flat')
              then cost_model.base_cost + coalesce(nullif(cost_model.markup->>'value', '')::numeric, 0)
            else cost_model.base_cost
          end as marked_cost
        from shipments s
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
        where s.order_id = o.id
          and coalesce(s.voided, false) = false
        order by s.id desc
        limit 1
      ) ls on true
      where oi.quantity > 0
    ),
    order_sku_rows as (
      select
        order_id,
        max(order_number)                                                   as order_number,
        min(order_date)                                                      as order_date,
        max(order_status)                                                    as order_status,
        max(ship_to_name)                                                    as ship_to_name,
        max(carrier_code)                                                    as carrier_code,
        max(service_code)                                                    as service_code,
        max(shipment_order_id)                                               as shipment_order_id,
        max(label_cost)                                                      as label_cost,
        bool_or(externally_shipped_flag)                                     as externally_shipped_flag,
        sku_key,
        max(sku)                                                             as sku,
        (array_agg(item_name order by length(item_name) desc))[1]            as item_name,
        sum(qty)::int                                                        as qty,
        max(unit_price)                                                      as unit_price
      from item_rows
      group by order_id, sku_key
    ),
    allocated as (
      select
        r.*,
        sum(qty) over (partition by r.order_id)::int                         as order_qty_total,
        case
          when r.order_status = 'shipped' and r.shipment_order_id is null then true
          else false
        end                                                                 as is_external,
        case
          when lower(coalesce(r.service_code, '')) = ANY(${EXPEDITED_SERVICES_SQL})
            then 'exp'
          else 'std'
        end                                                                 as ship_class
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
        when not is_external and label_cost > 0 then (label_cost / nullif(order_qty_total, 0))::text
        else null
      end as shipping_cost,
      case
        when not is_external and label_cost > 0 then (label_cost * qty / nullif(order_qty_total, 0))::text
        else null
      end as shipping_total,
      case
        when not is_external and label_cost > 0 and ship_class = 'std' then (label_cost / nullif(order_qty_total, 0))::text
        else null
      end as standard_shipping_cost,
      case
        when not is_external and label_cost > 0 and ship_class = 'std' then (label_cost * qty / nullif(order_qty_total, 0))::text
        else null
      end as standard_shipping_total,
      (is_external or externally_shipped_flag)                               as is_external_shipped
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
        standard_shipping_cost: null,
        standard_shipping_total: null,
      }));

  return {
    sku,
    name: input.name ?? null,
    clientId: input.clientId ?? null,
    totalUnits: dailySales.reduce((sum, r) => sum + r.units, 0),
    standardShipCount: visibleShippingSummary?.standard_ship_count ?? 0,
    standardShippingTotal: visibleShippingSummary?.standard_shipping_total ?? '0',
    avgStandardShippingCost: visibleShippingSummary?.avg_standard_shipping_cost ?? '0',
    dailySales,
    orders: visibleRows,
  };
}

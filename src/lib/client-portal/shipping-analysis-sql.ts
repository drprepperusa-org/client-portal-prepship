// CP-060 AC-4 — THE shipping-analysis definition, shared by both analysis paths.
//
// The card requires "the Analysis table and SKU drawer use the same backend
// definitions". Two copies that happen to agree today is not that: CP-060 exists
// because an order-grain sum and a per-shipment split drifted apart while nobody
// was looking, and the Dashboard's shipping figure kept the pre-CP-060 model for
// a further three audit rounds because the table path was never converged. So
// the definition lives here, once, and both callers import it.
//
// Callers must alias the orders table as `o` and must not alias `shipments`
// (the canonical resolver fragments render unqualified `shipments.*`).
//
// Consumers:
//   - src/services/sku-orders.ts        (Analysis SKU drawer, per-order rows)
//   - src/routes/analysis.ts            (Analysis SKU table, per-SKU aggregates,
//                                        and via it the client Dashboard)
import { sql, type SQL } from 'drizzle-orm';
import { shipments } from '../../db/schema/shipments';
import {
  shipmentCustomerShippingRateSql,
  shipmentIsCustomerShippingEligibleSql,
} from './customer-shipping-rate';
import { EXPEDITED_SERVICES_SQL } from '../shipping-class';

/**
 * Per-order money aggregate over ONE row set: the shipments the canonical
 * resolver admits (not voided, not a return). Money per shipment is
 * `shipmentCustomerShippingRateSql()` — PrepShip's frozen billing line, falling
 * back to its frozen rate snapshot — which is exactly what
 * `orderCustomerShippingRateSql()` sums for the Orders surface, so every
 * consumer of this lateral shares that value.
 *
 * `is_exp` is total (coalesce + `= ANY` over a non-null array never yields
 * NULL), so std + exp equals the total for every non-null row by construction
 * rather than by invariant.
 *
 * `customer_money` is deliberately NOT coalesced to 0: NULL means the resolver
 * has no answer yet for any eligible label — the `pending` state — which is a
 * different fact from a billed $0.00.
 *
 * Emits: active_label_count, service_code, customer_money, customer_std,
 * customer_exp, house_money, house_std, house_exp. Joined as `labels`.
 */
export function eligibleShipmentMoneyLateralSql(): SQL {
  return sql`
    left join lateral (
      select
        count(*)::int                                                       as active_label_count,
        max(${shipments.serviceCode})                                       as service_code,
        sum(money.amount)                                                   as customer_money,
        coalesce(sum(money.amount) filter (where cls.is_exp), 0)::numeric   as customer_exp,
        coalesce(sum(money.amount) filter (where not cls.is_exp), 0)::numeric as customer_std,
        sum(house.amount)                                                   as house_money,
        coalesce(sum(house.amount) filter (where cls.is_exp), 0)::numeric   as house_exp,
        coalesce(sum(house.amount) filter (where not cls.is_exp), 0)::numeric as house_std
      from ${shipments}
      cross join lateral (
        select (${shipmentCustomerShippingRateSql()})::numeric as amount
      ) money
      left join settings pid_markup
        on pid_markup.key = 'markup.' || coalesce(
             ${shipments.providerAccountId}, ${shipments.labelProvider}, ${shipments.selectedPid}
           )::text
      left join settings carrier_markup
        on carrier_markup.key in (
             'markup.' || ${shipments.carrierCode},
             'markup.' || lower(${shipments.carrierCode})
           )
      cross join lateral (
        select
          (coalesce(${shipments.cost}, ${shipments.labelCost}, 0)
            + coalesce(${shipments.otherCost}, 0))::numeric as base_cost,
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
        select lower(coalesce(${shipments.serviceCode}, '')) = ANY(${EXPEDITED_SERVICES_SQL}) as is_exp
      ) cls
      where ${shipments.orderId} = o.id
        and ${shipmentIsCustomerShippingEligibleSql()}
    ) labels on true
  `;
}

/**
 * Whether the order has any OUTBOUND shipment at all, eligible or not. Matches
 * `active_label_count`'s population on the return dimension, so a return-only
 * order is not reported as "label voided". Joined as `sh`.
 */
export function hasOutboundShipmentLateralSql(): SQL {
  return sql`
    cross join lateral (
      select exists (
        select 1 from shipments s2
        where s2.order_id = o.id
          and coalesce(s2.is_return, false) = false
      ) as has_any_shipment
    ) sh
  `;
}

/**
 * What Billing actually charges for shipping on this order: EXACTLY the
 * definition the invoice and billing summaries use
 * (read-models/invoice-details.ts, services/billing-summaries.ts) — every
 * `shipping` line by order_id, with no shipment-validity filter.
 *
 * This is NOT a competing figure to display. It exists so a consumer can tell
 * when the canonical outbound figure and the invoice disagree. A display
 * resolver cannot make charged money stop being the customer's money by
 * declining to look at it (Hermes, CP-060 return 2026-08-22): `voidLabelV2`
 * leaves billing rows in place when it voids a shipment, and no constraint ties
 * a line's shipment_id to its own order.
 *
 * The per-cause counts DRIVE classification (see `billingMismatchSql`): any
 * abnormal-lineage line makes the row a mismatch regardless of which way the
 * money nets. Their individual causes stay internal — telling a customer
 * "voided-linked" discloses internal shipment structure they can act on none of.
 *
 * Emits: invoiced_shipping, unattached_lines, foreign_lines, ineligible_lines.
 * Joined as `inv`.
 */
export function invoicedShippingLateralSql(): SQL {
  return sql`
    left join lateral (
      select
        coalesce(sum(b.total_cost), 0)::numeric                              as invoiced_shipping,
        count(*) filter (where b.shipment_id is null)::int                   as unattached_lines,
        count(*) filter (
          where b.shipment_id is not null
            and not exists (
              select 1 from shipments sx
              where sx.id = b.shipment_id and sx.order_id = o.id
            )
        )::int                                                               as foreign_lines,
        count(*) filter (
          where exists (
            select 1 from shipments sy
            where sy.id = b.shipment_id
              and sy.order_id = o.id
              and (coalesce(sy.voided, false) = true or coalesce(sy.is_return, false) = true)
          )
        )::int                                                               as ineligible_lines
      from billing_line_items b
      where b.order_id = o.id and b.line_type = 'shipping'
    ) inv on true
  `;
}

/**
 * The per-basis money columns, INCLUDING the reconciliation inputs the money
 * state is computed from. Both live here together on purpose.
 *
 * The reconciliation compares what Billing CHARGES THE CUSTOMER against what the
 * canonical resolver attributes. That comparison is only meaningful on the
 * customer basis. `house_markup` is internal marked cost — a different money
 * base entirely — so comparing it against customer invoices would manufacture a
 * mismatch out of the ordinary difference between what we pay and what we
 * charge. The house basis therefore reconciles against itself
 * (`money_invoiced = house_money`, `money_odd_lines = 0`), which makes
 * `billing_mismatch` unreachable there by construction.
 *
 * This used to be duplicated in the drawer while the table injected the customer
 * reconciliation inputs unconditionally, so the same house-basis order could
 * read `attributed` in one surface and `billing_mismatch` in the other
 * (Hermes, CP-060, 2026-08-22). Keeping the switch beside the state case is what
 * stops that recurring.
 */
export function moneyColumnsSql(basis: 'house_markup' | 'customer_billed'): SQL {
  return basis === 'customer_billed'
    ? sql`
        labels.customer_money                                              as money_total,
        labels.customer_std                                                as money_std,
        labels.customer_exp                                                as money_exp,
        inv.invoiced_shipping                                              as money_invoiced,
        (inv.unattached_lines + inv.foreign_lines + inv.ineligible_lines)  as money_odd_lines,
      `
    : sql`
        labels.house_money                                                 as money_total,
        labels.house_std                                                   as money_std,
        labels.house_exp                                                   as money_exp,
        labels.house_money                                                 as money_invoiced,
        0::int                                                             as money_odd_lines,
      `;
}

/**
 * Two independent triggers, because a money delta alone is not enough:
 *
 *   1. ANY abnormal-lineage line exists. Its amount may be NEGATIVE, in which
 *      case the invoice is LOWER than the label sum and a delta test aimed at
 *      overbilling misses it entirely. Two abnormal lines can also cancel and
 *      leave the totals equal with the lineage still wrong. Presence, not net
 *      amount, is the honest signal.
 *   2. Billing charges more than the eligible labels resolve to, even with no
 *      individually abnormal line.
 *
 * The ordinary pre-billing window is deliberately NOT a mismatch: a frozen
 * snapshot with no Billing lines has zero abnormal lines and a negative delta.
 *
 * Expects the aggregated row aliased `r` carrying money_odd_lines,
 * money_invoiced and money_total.
 */
export function billingMismatchSql(): SQL {
  return sql`
    (
      coalesce(r.money_odd_lines, 0) > 0
      or (coalesce(r.money_invoiced, 0) - coalesce(r.money_total, 0)) > 0.005
    )
  `;
}

/**
 * Why the order has, or has not, a shipping figure. Order matters:
 * `billing_mismatch` outranks the shipment-shape branches, because an order
 * whose labels are all voided but which is still charged is not adequately
 * described as "label voided". The shape branches then explain an absent figure
 * better than the money branches could, and `pending` is reached only when an
 * eligible label exists.
 *
 * Expects the aggregated row aliased `r`.
 */
export function shippingMoneyStateCaseSql(): SQL {
  return sql`
    case
      when ${billingMismatchSql()} then 'billing_mismatch'
      when coalesce(r.active_label_count, 0) = 0 and not r.has_any_shipment
           and r.order_status = 'shipped' then 'external_label'
      when coalesce(r.active_label_count, 0) = 0 and r.has_any_shipment then 'voided_only'
      when r.money_total is null then 'pending'
      else 'attributed'
    end
  `;
}

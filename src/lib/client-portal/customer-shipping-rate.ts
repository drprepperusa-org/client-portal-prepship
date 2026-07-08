import { sql, type SQL } from 'drizzle-orm';
import { billingConfig } from '../../db/schema/billing';
import { orderOverrides, orders } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';

function positiveNumericText(value: SQL | unknown): SQL {
  return sql`case
    when coalesce(${value}, '') ~ '^[0-9]+([.][0-9]+)?$' then (${value})::numeric
    else 0::numeric
  end`;
}

/**
 * SQL mirror of computeCustomerShippingRate in
 * src/services/customer-shipping-rate.ts for not-yet-billed shipments.
 *
 * Source/clock/formula/owner: the TS owner is the authoritative outbound
 * Customer Shipping Rate formula used by billing writes. This SQL exists only
 * because Client Portal read-models need the same formula inside set-based
 * queries: house cost = shipments.cost (fallback label_cost) + other_cost;
 * reference mode may raise the base to the best configured ref rate; then
 * client markup and the below-trigger customer-rate override are applied.
 */
export function projectedCustomerShippingRateSql(): SQL<string | null> {
  const houseCost = sql`(
    coalesce(nullif(${shipments.cost}, 0::numeric), ${shipments.labelCost}, 0::numeric)
    + coalesce(${shipments.otherCost}, 0::numeric)
  )`;
  const refUsps = positiveNumericText(orderOverrides.refUspsRate);
  const refUps = positiveNumericText(orderOverrides.refUpsRate);
  const referenceRate = sql`case
    when ${refUsps} > 0 and ${refUps} > 0 then least(${refUsps}, ${refUps})
    when ${refUsps} > 0 then ${refUsps}
    when ${refUps} > 0 then ${refUps}
    else null
  end`;
  const billedBase = sql`case
    when coalesce(${billingConfig.billingMode}, 'per_shipment') in ('reference_rate', 'ss_ref_rate')
      and coalesce(${shipments.carrierCode}, '') not in ('stamps_com', 'ups_walleted')
      and ${referenceRate} is not null
      then greatest(${houseCost}, ${referenceRate})
    else ${houseCost}
  end`;
  const markedUp = sql`(
    ${billedBase} * (1 + coalesce(${billingConfig.shippingMarkupPct}, 0::numeric) / 100)
    + coalesce(${billingConfig.shippingMarkupFlat}, 0::numeric)
  )`;

  return sql`case
    when coalesce(${billingConfig.active}, true) = true and ${houseCost} > 0 then
      round((
        case
          when coalesce(${billingConfig.shippingRateOverrideTriggerBelow}, 0::numeric) > 0
            and coalesce(${billingConfig.shippingRateOverrideAmount}, 0::numeric) > 0
            and ${houseCost} < coalesce(${billingConfig.shippingRateOverrideTriggerBelow}, 0::numeric)
            then coalesce(${billingConfig.shippingRateOverrideAmount}, 0::numeric)
          else ${markedUp}
        end
      )::numeric, 2)::text
    else null
  end`;
}

export function shipmentCustomerShippingRateSql(): SQL<string | null> {
  return sql`coalesce(
    (
      select sum(bli.total_cost)
      from billing_line_items bli
      where bli.shipment_id = ${shipments.id}
        and bli.line_type = 'shipping'
    )::text,
    ${projectedCustomerShippingRateSql()}
  )`;
}

/**
 * Order-grain C. Shipping Rate: the SAME per-shipment resolver above
 * (shipmentCustomerShippingRateSql — frozen billing line → projection) applied to
 * each of the order's NON-VOIDED shipments and summed. The Client Portal Orders
 * list/detail read-model uses this so an order row resolves the identical value
 * the Shipments surface shows — WITHOUT ever falling back to
 * orders.shipping_amount. Buyer-paid store/checkout shipping is unrelated to the
 * 3PL customer shipping rate and must not decide it (CP-040).
 *
 * Grain note: billing_line_items shipping rows carry BOTH order_id and
 * shipment_id (src/services/billing.ts), so summing the per-shipment frozen value
 * equals the order's frozen shipping. `order_overrides` is order-grain (one row
 * per order, shared by every shipment), and `billing_config` is client-grain —
 * both are joined inside this correlated subquery so it is self-contained.
 *
 * Source/clock/formula/owner: identical to shipmentCustomerShippingRateSql (this
 * module owns it; clock = ship/bill time). Returns null when NO shipment has a
 * frozen line or a projectable house cost — the DTO then renders "—", or
 * "Pending" if the order still has an active shipment.
 */
export function orderCustomerShippingRateSql(): SQL<string | null> {
  return sql`(
    select sum((${shipmentCustomerShippingRateSql()})::numeric)::text
    from ${shipments}
    left join ${billingConfig} on ${billingConfig.clientId} = ${shipments.clientId}
    left join ${orderOverrides} on ${orderOverrides.orderId} = ${shipments.orderId}
    where ${shipments.orderId} = ${orders.id}
      and coalesce(${shipments.voided}, false) = false
  )`;
}

import { sql, type SQL } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';

/**
 * Compatibility name retained for callers. PS-437 removed the SQL pricing
 * mirror: this now reads only PrepShip's explicit, policy-versioned shipment
 * snapshot and never derives customer money from cost or billing config.
 */
export function projectedCustomerShippingRateSql(): SQL<string | null> {
  return sql`case
    when coalesce(${shipments.selectedRateJson}, '{}'::jsonb) ?& array[
      'selectedRateCost',
      'cShippingRateAmount',
      'shippingMarginAmount',
      'shippingMarginPct',
      'customerRateSource',
      'rateCostSource',
      'customerShippingMoneyPolicyVersion'
    ]::text[]
      and jsonb_typeof(${shipments.selectedRateJson}->'selectedRateCost') = 'number'
      and jsonb_typeof(${shipments.selectedRateJson}->'cShippingRateAmount') = 'number'
      and jsonb_typeof(${shipments.selectedRateJson}->'shippingMarginAmount') = 'number'
      and jsonb_typeof(${shipments.selectedRateJson}->'shippingMarginPct') in ('number', 'null')
      and (${shipments.selectedRateJson}->>'selectedRateCost')::numeric > 0
      and (${shipments.selectedRateJson}->>'cShippingRateAmount')::numeric > 0
      and round(
        (${shipments.selectedRateJson}->>'cShippingRateAmount')::numeric
          - (${shipments.selectedRateJson}->>'selectedRateCost')::numeric,
        2
      ) = round((${shipments.selectedRateJson}->>'shippingMarginAmount')::numeric, 2)
      and ${shipments.selectedRateJson}->>'customerRateSource' in (
        'realized_customer_shipping_rate',
        'hugrab_shipping_rate_override'
      )
      and ${shipments.selectedRateJson}->>'rateCostSource' = 'label_final_cost'
      and ${shipments.selectedRateJson}->>'customerShippingMoneyPolicyVersion' = 'ps-437-v1'
      then (${shipments.selectedRateJson}->>'cShippingRateAmount')::numeric::text
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
 * (shipmentCustomerShippingRateSql — frozen billing line → frozen snapshot) applied to
 * each of the order's NON-VOIDED shipments and summed. The Client Portal Orders
 * list/detail read-model uses this so an order row resolves the identical value
 * the Shipments surface shows — WITHOUT ever falling back to
 * orders.shipping_amount. Buyer-paid store/checkout shipping is unrelated to the
 * 3PL customer shipping rate and must not decide it (CP-040).
 *
 * Grain note: billing_line_items shipping rows carry BOTH order_id and
 * shipment_id, so summing the per-shipment frozen value equals the order's
 * frozen shipping. No billing-config or order-override policy is joined here.
 *
 * Source/clock/owner: PrepShip's frozen tuple at label/bill time. Returns null
 * when no shipment has a frozen line or canonical tuple — the DTO renders "—", or
 * "Pending" if the order still has an active shipment.
 */
export function orderCustomerShippingRateSql(): SQL<string | null> {
  return sql`(
    select sum((${shipmentCustomerShippingRateSql()})::numeric)::text
    from ${shipments}
    where ${shipments.orderId} = ${orders.id}
      and coalesce(${shipments.voided}, false) = false
  )`;
}

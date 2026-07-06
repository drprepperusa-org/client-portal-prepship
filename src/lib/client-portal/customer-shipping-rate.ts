import { sql, type SQL } from 'drizzle-orm';
import { billingConfig } from '../../db/schema/billing';
import { orderOverrides } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';

function positiveNumericText(value: SQL | unknown): SQL {
  return sql`case
    when coalesce(${value}, '') ~ '^[0-9]+([.][0-9]+)?$' then (${value})::numeric
    else 0::numeric
  end`;
}

/**
 * Backend-owned live projection of C. Shipping Rate for not-yet-billed
 * shipments. Inputs match src/services/billing.ts generateLineItems:
 * house cost = shipments.cost (fallback label_cost) + other_cost; reference
 * mode may raise the base to the best configured ref rate; then client markup
 * and the below-trigger customer-rate override are applied.
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

import { sql, type SQL } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import { returns } from '../../db/schema/returns';
import { shipments } from '../../db/schema/shipments';

function frozenCustomerShippingTupleHasValidMoneySql(): SQL {
  return sql`coalesce(${shipments.selectedRateJson}, '{}'::jsonb) ?& array[
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
  `;
}

/**
 * PS-437 return/replacement tuple — the HISTORICAL lane, arbitrated 2026-08-24 (Hermes PS-508
 * re-audit): these tuples intentionally lack billingDescriptionSuffix because they predate the
 * eighth field and are billed by the return/replacement billers, which never flow through
 * PrepShip's ordinary-outbound decision owner. The suffix is therefore deliberately NOT
 * required here. If PrepShip's ordinary Billing ever encounters a suffix-less ps-437 tuple it
 * fails CLOSED to review — that boundary belongs to Billing, and this lane must not widen to
 * cover it. Only ps-508/ps-509 (below) mirror Billing's suffix-required contract.
 */
function frozenCustomerShippingTupleIsValidSql(): SQL {
  return sql`(${frozenCustomerShippingTupleHasValidMoneySql()})
    and ${shipments.selectedRateJson}->>'customerRateSource' in (
      'realized_customer_shipping_rate',
      'hugrab_shipping_rate_override'
    )
    and ${shipments.selectedRateJson}->>'rateCostSource' = 'label_final_cost'
    and ${shipments.selectedRateJson}->>'customerShippingMoneyPolicyVersion' = 'ps-437-v1'
    and not (
      coalesce(${shipments.selectedRateJson}, '{}'::jsonb)
        ? 'customerShippingMoneyCaptureSource'
    )`;
}

/** PS-508 ordinary-outbound label-purchase tuple. */
function frozenOutboundPurchaseCustomerShippingTupleIsValidSql(): SQL {
  return sql`(${frozenCustomerShippingTupleHasValidMoneySql()})
    and ${shipments.selectedRateJson}->>'customerRateSource' in (
      'realized_customer_shipping_rate',
      'hugrab_shipping_rate_override',
      'house_next_best_customer_rate'
    )
    and ${shipments.selectedRateJson}->>'rateCostSource' = 'label_final_cost'
    and ${shipments.selectedRateJson}->>'customerShippingMoneyPolicyVersion' = 'ps-508-v1'
    -- PS-508 contract parity (Hermes re-audit 2026-08-24, correction 5): Billing fails a
    -- ps-508-v1 tuple CLOSED to review when billingDescriptionSuffix is absent, because the
    -- suffix is part of the duplicate-suppression key. The Portal must not display as the
    -- customer rate a tuple Billing would hold, so it enforces the same requirement.
    and jsonb_typeof(${shipments.selectedRateJson}->'billingDescriptionSuffix') = 'string'
    and not (
      coalesce(${shipments.selectedRateJson}, '{}'::jsonb)
        ? 'customerShippingMoneyCaptureSource'
    )`;
}

/** PS-509 ShipStation sync-ingress tuple. */
function frozenSyncIngressCustomerShippingTupleIsValidSql(): SQL {
  return sql`(${frozenCustomerShippingTupleHasValidMoneySql()})
    and ${shipments.selectedRateJson}->>'customerRateSource' in (
      'carrier_markup_customer_shipping_rate',
      'hugrab_shipping_rate_override'
    )
    and ${shipments.selectedRateJson}->>'rateCostSource' = 'shipstation_sync_receipt_cost'
    and ${shipments.selectedRateJson}->>'customerShippingMoneyPolicyVersion' = 'ps-509-v1'
    -- PS-508 re-audit round 2: Billing's decision owner requires the suffix for EVERY tuple it
    -- bills, ps-509 included. The normal ingress writer always emits it, but a malformed or
    -- hand-written tuple without it would be HELD by Billing — so it must not read as settled
    -- money here either. Same fail-closed contract as the ps-508 lane above.
    and jsonb_typeof(${shipments.selectedRateJson}->'billingDescriptionSuffix') = 'string'
    and coalesce(${shipments.selectedRateJson}, '{}'::jsonb)
      ? 'customerShippingMoneyCaptureSource'
    and ${shipments.selectedRateJson}->>'customerShippingMoneyCaptureSource'
      = 'shipstation_sync_ingestion'`;
}

/**
 * PS-437 is deliberately ABSENT from this non-return union (Hermes PS-508 round-3, P4).
 * The only writers of ps-437 tuples are the return freeze (isReturn=true shipments, covered by
 * the return-lane projection) and the replacement freeze — and PS-502's replacement tables do
 * not exist in production yet, so source topology implies a zero legitimate non-return ps-437
 * display population (UNVERIFIED against the production catalog — no runtime readback was in
 * scope; the claim is structural, not measured). Accepting the version here would let any suffix-less ps-437 tuple on an ordinary
 * shipment read as settled money with no relational proof it belongs to the replacement lane.
 * When PS-502 lands, reintroduce the branch WITH that proof, e.g.
 *   exists (select 1 from replacements r where r.replacement_shipment_id = shipments.id)
 * — never as a bare version check. Fail-closed until then.
 */
function frozenOutboundCustomerShippingTupleIsValidSql(): SQL {
  return sql`(
    (${frozenOutboundPurchaseCustomerShippingTupleIsValidSql()})
    or (${frozenSyncIngressCustomerShippingTupleIsValidSql()})
  )`;
}

function frozenCustomerShippingAmountSql(): SQL {
  return sql`(${shipments.selectedRateJson}->>'cShippingRateAmount')::numeric`;
}

/**
 * Compatibility name retained for callers. This reads only PrepShip's
 * explicit, policy-versioned shipment snapshot and never derives customer
 * money from cost or billing config. Return labels remain ps-437-only;
 * ordinary outbound labels accept the canonical ps-437/508/509 contracts.
 */
export function projectedCustomerShippingRateSql(): SQL<string | null> {
  return sql`case
    when coalesce(${shipments.isReturn}, false) = true
      and ${frozenCustomerShippingTupleIsValidSql()}
      then (${frozenCustomerShippingAmountSql()})::text
    when coalesce(${shipments.isReturn}, false) = false
      and ${frozenOutboundCustomerShippingTupleIsValidSql()}
      then (${frozenCustomerShippingAmountSql()})::text
    else null
  end`;
}

/**
 * Return workflows keep a compatibility amount on `returns`, but it is safe
 * for customer display only when the linked shipment has PrepShip's complete
 * policy-versioned tuple and the alias agrees with that tuple to the cent.
 */
export function validatedReturnCustomerShippingRateSql(): SQL<string | null> {
  return sql`case
    when ${returns.returnCustomerShippingRate} is not null
      and ${frozenCustomerShippingTupleIsValidSql()}
      and round(${returns.returnCustomerShippingRate}::numeric, 2)
        = round(${frozenCustomerShippingAmountSql()}, 2)
      then (${frozenCustomerShippingAmountSql()})::text
    else null
  end`;
}

/**
 * Historical `return_postage` lines are customer-safe only when their linked
 * return alias and shipment tuple both prove the same canonical amount. Other
 * billing line types pass through unchanged.
 */
export function customerSafeBillingLineSql(input: {
  lineType: SQL;
  shipmentId: SQL;
  totalCost: SQL;
}): SQL {
  return sql`(
    coalesce(${input.lineType}, '') <> 'return_postage'
    or exists (
      select 1
      from ${shipments}
      inner join ${returns} on ${returns.returnShipmentId} = ${shipments.id}
      where ${shipments.id} = ${input.shipmentId}
        and ${returns.returnCustomerShippingRate} is not null
        and ${frozenCustomerShippingTupleIsValidSql()}
        and round(${returns.returnCustomerShippingRate}::numeric, 2)
          = round(${frozenCustomerShippingAmountSql()}, 2)
        and round(${input.totalCost}::numeric, 2)
          = round(${frozenCustomerShippingAmountSql()}, 2)
    )
  )`;
}

/**
 * Which shipments carry the customer's outbound shipping money: not voided,
 * not a return. THE single definition — `orderCustomerShippingRateSql()` below
 * and the Analysis SKU drawer read model (src/services/sku-orders.ts) both call
 * this rather than spelling the predicate out, so the drawer can never drift
 * from the order-grain value it must reconcile with. Renders unqualified
 * `shipments.*`, so callers must select `from shipments` without an alias.
 */
export function shipmentIsCustomerShippingEligibleSql(): SQL {
  return sql`(
    coalesce(${shipments.voided}, false) = false
    and coalesce(${shipments.isReturn}, false) = false
  )`;
}

export function shipmentCustomerShippingRateSql(): SQL<string | null> {
  // Preserve the outer shipment qualifier inside the billing-line subquery.
  const correlatedShipmentId = sql`${shipments.id}`;
  return sql`coalesce(
    (
      select sum(bli.total_cost)
      from billing_line_items bli
      where bli.shipment_id = ${correlatedShipmentId}
        and bli.line_type = 'shipping'
    )::text,
    ${projectedCustomerShippingRateSql()}
  )`;
}

/**
 * Order-grain C. Shipping Rate: the SAME per-shipment resolver above
 * (shipmentCustomerShippingRateSql — frozen billing line → frozen snapshot) applied to
 * each of the order's NON-VOIDED, NON-RETURN shipments and summed. The Client Portal Orders
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
  // Keep the outer table qualifier when Drizzle embeds this fragment in a
  // single-table select; a direct column chunk can otherwise become `id`.
  const correlatedOrderId = sql`${orders.id}`;
  return sql`(
    select sum((${shipmentCustomerShippingRateSql()})::numeric)::text
    from ${shipments}
    where ${shipments.orderId} = ${correlatedOrderId}
      and ${shipmentIsCustomerShippingEligibleSql()}
  )`;
}

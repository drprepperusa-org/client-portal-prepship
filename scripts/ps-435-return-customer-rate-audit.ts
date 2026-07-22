/**
 * PS-435 read-only reconciliation audit.
 *
 * Requires an explicitly supplied read-only connection string and performs no
 * updates, repairs, provider calls, label creation, or customer delivery.
 */
import postgres from 'postgres';

const databaseUrl = process.env.PS435_READONLY_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('Set PS435_READONLY_DATABASE_URL to an explicitly read-only database connection');
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });

try {
  const rows = await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    return tx<{
      category: string;
      affected_rows: number;
      return_ids: number[];
    }[]>`
      with return_truth as (
        select
          r.id as return_id,
          r.return_shipment_id,
          r.return_customer_shipping_rate::numeric as alias_amount,
          case
            when coalesce(s.selected_rate_json, '{}'::jsonb) ?& array[
              'selectedRateCost',
              'cShippingRateAmount',
              'shippingMarginAmount',
              'shippingMarginPct',
              'customerRateSource',
              'rateCostSource',
              'customerShippingMoneyPolicyVersion'
            ]::text[]
              and jsonb_typeof(s.selected_rate_json->'selectedRateCost') = 'number'
              and jsonb_typeof(s.selected_rate_json->'cShippingRateAmount') = 'number'
              and jsonb_typeof(s.selected_rate_json->'shippingMarginAmount') = 'number'
              and jsonb_typeof(s.selected_rate_json->'shippingMarginPct') in ('number', 'null')
              and (s.selected_rate_json->>'selectedRateCost')::numeric > 0
              and (s.selected_rate_json->>'cShippingRateAmount')::numeric > 0
              and round(
                (s.selected_rate_json->>'cShippingRateAmount')::numeric
                  - (s.selected_rate_json->>'selectedRateCost')::numeric,
                2
              ) = round((s.selected_rate_json->>'shippingMarginAmount')::numeric, 2)
              and s.selected_rate_json->>'customerRateSource' in (
                'realized_customer_shipping_rate',
                'hugrab_shipping_rate_override'
              )
              and s.selected_rate_json->>'rateCostSource' = 'label_final_cost'
              and s.selected_rate_json->>'customerShippingMoneyPolicyVersion' = 'ps-437-v1'
              then (s.selected_rate_json->>'cShippingRateAmount')::numeric
            else null
          end as canonical_amount
        from returns r
        left join shipments s on s.id = r.return_shipment_id
        where r.return_shipment_id is not null
      ),
      billing_truth as (
        select
          rt.return_id,
          rt.return_shipment_id,
          rt.alias_amount,
          rt.canonical_amount,
          sum(b.total_cost)::numeric as billed_amount
        from return_truth rt
        left join billing_line_items b
          on b.shipment_id = rt.return_shipment_id
          and b.line_type = 'return_postage'
        group by rt.return_id, rt.return_shipment_id, rt.alias_amount, rt.canonical_amount
      ),
      findings as (
        select return_id, 'missing_canonical_tuple'::text as category
        from billing_truth
        where canonical_amount is null
        union all
        select return_id, 'alias_tuple_mismatch'
        from billing_truth
        where canonical_amount is not null
          and (alias_amount is null or round(alias_amount, 2) <> round(canonical_amount, 2))
        union all
        select return_id, 'billing_tuple_mismatch'
        from billing_truth
        where billed_amount is not null
          and (canonical_amount is null or round(billed_amount, 2) <> round(canonical_amount, 2))
      )
      select
        category,
        count(*)::int as affected_rows,
        (array_agg(return_id order by return_id))[1:25]::int[] as return_ids
      from findings
      group by category
      order by category
    `;
  });

  console.log(JSON.stringify({ mode: 'read_only', findings: rows }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}

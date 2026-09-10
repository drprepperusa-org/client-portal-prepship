import { sql, type SQLWrapper } from 'drizzle-orm';

/** Same first displayed item as dto.safeItems: preserve array order, omit discounts.
 * Price is only used to identify a discount, never returned or used as a sort key.
 * Invalid numeric text remains a normal item, as in isDiscountLine.
 */
export function firstShipmentItemSql(items: SQLWrapper, field: 'name' | 'sku') {
  return sql`(select case when jsonb_typeof(item->${field}) = 'string' then lower(item->>${field}) end
    from jsonb_array_elements(case when jsonb_typeof(${items}) = 'array' then ${items} else '[]'::jsonb end)
      with ordinality as lines(item, position)
    cross join lateral (select coalesce(item->>'unitPrice', item->>'unit_price', item->>'price') as price) p
    where not coalesce(case when pg_input_is_valid(price, 'double precision')
      then price::double precision < 0 and price::double precision > '-Infinity'::double precision
      else false end, false)
    order by position limit 1)`;
}

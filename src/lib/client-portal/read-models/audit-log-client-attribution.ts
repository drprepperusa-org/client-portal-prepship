import { sql, type SQL } from 'drizzle-orm';
import { clientPortalAuditLogs } from '../../../db/schema/client-portal-audit-logs';

const metadata = clientPortalAuditLogs.metadata;
const TARGET_KEYS = ['clientId', 'clientIds', 'storeId', 'storeIds', 'orderId', 'returnId', 'shipmentId', 'inventoryId'];

// JSON values are untrusted historical data. Numeric comparison precedes int casting.
function safeId(value: SQL): SQL {
  return sql`case when ${value} ~ '^[1-9][0-9]{0,9}$'
    then case when (${value})::numeric <= 2147483647 then (${value})::int end end`;
}
function id(key: string): SQL { return safeId(sql`${metadata}->>${key}`); }
function ids(key: string): SQL {
  return sql`select ${safeId(sql`value`)} from jsonb_array_elements_text(
    case when jsonb_typeof(${metadata}->${key}) = 'array' then ${metadata}->${key} else '[]'::jsonb end
  ) values_in(value)`;
}

/** Event ownership, shared by summary and drill-down; session scope is never broad attribution. */
export function auditActivityClientIds(): SQL {
  const hasTarget = sql`exists (select 1 from unnest(array[${sql.join(TARGET_KEYS.map(k => sql`${k}`), sql`, `)}]::text[]) k
    where ${metadata}->k is not null and ${metadata}->k <> 'null'::jsonb)`;
  return sql`case when ${hasTarget} then array(
    select distinct owner_id from (
      select ${id('clientId')} as owner_id
      union all select * from (${ids('clientIds')}) explicit_clients
      union all select c.id from clients c where c.store_ids && array(
        select ${id('storeId')} union all select * from (${ids('storeIds')}) explicit_stores
      )
      union all select o.client_id from orders o where o.id = ${id('orderId')}
      union all select c.id from orders o join clients c on o.store_id = any(c.store_ids)
        where o.id = ${id('orderId')} and o.client_id is null
      union all select coalesce(r.client_id, o.client_id) from returns r left join orders o on o.id = r.order_id
        where r.id = ${id('returnId')}
      union all select coalesce(s.client_id, o.client_id) from shipments s left join orders o on o.id = s.order_id
        where s.id = ${id('shipmentId')}
      union all select i.client_id from inventory i where i.id = ${id('inventoryId')}
    ) owners where owner_id is not null
  ) when cardinality(${clientPortalAuditLogs.clientIds}) = 1 then ${clientPortalAuditLogs.clientIds}
    when cardinality(${clientPortalAuditLogs.clientIds}) = 0 and cardinality(${clientPortalAuditLogs.storeIds}) = 1
      then array(select c.id from clients c where c.store_ids && ${clientPortalAuditLogs.storeIds})
    else array[]::int[] end`;
}

export function auditActivityClientPredicate(clientId: number): SQL {
  return sql`${clientId} = any(${auditActivityClientIds()})`;
}

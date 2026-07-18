import { sql, type SQL } from 'drizzle-orm';
import { clientPortalAuditLogs } from '../../../db/schema/client-portal-audit-logs';
import { clients } from '../../../db/schema/clients';
import { inventory } from '../../../db/schema/inventory';
import { orders } from '../../../db/schema/orders';
import { returns } from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';

const metadata = clientPortalAuditLogs.metadata;

function jsonPositiveInt(key: string): SQL {
  return sql`case
    when jsonb_typeof(${metadata}->${key}) = 'number'
      and (${metadata}->>${key}) ~ '^[1-9][0-9]*$'
    then (${metadata}->>${key})::int
    else null
  end`;
}

function jsonPositiveIntArray(key: string): SQL {
  return sql`select value::int
    from jsonb_array_elements_text(
      case when jsonb_typeof(${metadata}->${key}) = 'array'
        then ${metadata}->${key}
        else '[]'::jsonb
      end
    ) as audit_value(value)
    where value ~ '^[1-9][0-9]*$'`;
}

function clientOwnsStore(clientId: SQL, storeId: number): SQL {
  return sql`exists (
    select 1
    from ${clients} audit_client
    where audit_client.id = ${clientId}
      and audit_client.store_ids @> array[${storeId}]::int[]
  )`;
}

/**
 * Canonical Audit Log store attribution.
 *
 * `client_portal_audit_logs.store_ids` is the actor's authorization/session
 * scope, not necessarily the store affected by the event. A store filter must
 * therefore prefer explicit event metadata and canonical resource ownership.
 * Session scope is used only when it contains exactly one store.
 */
export function auditActivityStorePredicate(storeId: number): SQL {
  const explicitStoreId = jsonPositiveInt('storeId');
  const explicitClientId = jsonPositiveInt('clientId');
  const orderId = jsonPositiveInt('orderId');
  const returnId = jsonPositiveInt('returnId');
  const shipmentId = jsonPositiveInt('shipmentId');
  const inventoryId = jsonPositiveInt('inventoryId');
  const explicitStoreIds = jsonPositiveIntArray('storeIds');
  const explicitClientIds = jsonPositiveIntArray('clientIds');

  return sql`(
    ${explicitStoreId} = ${storeId}
    or ${storeId} in (${explicitStoreIds})
    or ${clientOwnsStore(explicitClientId, storeId)}
    or exists (
      select 1
      from ${clients} audit_client
      where audit_client.id in (${explicitClientIds})
        and audit_client.store_ids @> array[${storeId}]::int[]
    )
    or exists (
      select 1
      from ${orders} audit_order
      where audit_order.id = ${orderId}
        and (
          audit_order.store_id = ${storeId}
          or ${clientOwnsStore(sql`audit_order.client_id`, storeId)}
        )
    )
    or exists (
      select 1
      from ${returns} audit_return
      left join ${orders} audit_return_order on audit_return_order.id = audit_return.order_id
      where audit_return.id = ${returnId}
        and (
          audit_return_order.store_id = ${storeId}
          or ${clientOwnsStore(sql`coalesce(audit_return.client_id, audit_return_order.client_id)`, storeId)}
        )
    )
    or exists (
      select 1
      from ${shipments} audit_shipment
      left join ${orders} audit_shipment_order on audit_shipment_order.id = audit_shipment.order_id
      where audit_shipment.id = ${shipmentId}
        and (
          audit_shipment_order.store_id = ${storeId}
          or ${clientOwnsStore(sql`coalesce(audit_shipment.client_id, audit_shipment_order.client_id)`, storeId)}
        )
    )
    or exists (
      select 1
      from ${inventory} audit_inventory
      where audit_inventory.id = ${inventoryId}
        and ${clientOwnsStore(sql`audit_inventory.client_id`, storeId)}
    )
    or (
      ${explicitStoreId} is null
      and ${explicitClientId} is null
      and ${orderId} is null
      and ${returnId} is null
      and ${shipmentId} is null
      and ${inventoryId} is null
      and not exists (${explicitStoreIds})
      and not exists (${explicitClientIds})
      and cardinality(${clientPortalAuditLogs.storeIds}) = 1
      and ${clientPortalAuditLogs.storeIds} @> array[${storeId}]::int[]
    )
  )`;
}

import { and, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { clients } from '../../db/schema/clients';
import { inventory } from '../../db/schema/inventory';
import { orderItems } from '../../db/schema/order-items';
import { orders } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';
import { SYNTHETIC_STORE_OFFSETS } from '../../services/credential-accounts';
import type { ClientPortalScope } from './scope';

/**
 * Client-portal scope + search predicates (extracted from routes/client-portal.ts).
 * These are the SQL guardrails that keep every portal read bounded to the
 * caller's client/store scope — the route file composes them per endpoint.
 */

export function intArrayLiteral(values: number[]) {
  return sql`array[${sql.join(values.map((id) => sql`${id}`), sql`, `)}]::int[]`;
}

function syntheticStoreIdMatchSql(orderStoreId: SQL): SQL {
  const providerMatches = Object.entries(SYNTHETIC_STORE_OFFSETS).map(([provider, offset]) => sql`(
    scoped_store_account.provider = ${provider}
    and ${orderStoreId} = ${offset} + scoped_store_account.id
  )`);
  const knownProviders = Object.keys(SYNTHETIC_STORE_OFFSETS);
  const knownProviderArray = sql`array[${sql.join(knownProviders.map((provider) => sql`${provider}`), sql`, `)}]::text[]`;
  return sql`(
    ${sql.join(providerMatches, sql` or `)}
    or (
      scoped_store_account.provider <> all(${knownProviderArray})
      and ${orderStoreId} = 9900000 + scoped_store_account.id
    )
  )`;
}

export function connectedStoreAccountOrderScopePredicate(clientIds: number[]): SQL | undefined {
  if (!clientIds.length) return undefined;
  const syntheticStoreMatch = syntheticStoreIdMatchSql(sql`${orders.storeId}`);
  return sql`exists (
    select 1
    from store_accounts scoped_store_account
    where scoped_store_account.client_id = any(${intArrayLiteral(clientIds)})
      and (
        (
          ${orders.sourceProvider} = scoped_store_account.provider
          and (
            ${orders.sourceAccountId} = 'store-account:' || scoped_store_account.id::text
            or ${orders.sourceAccountId} = scoped_store_account.id::text
          )
        )
        or ${syntheticStoreMatch}
      )
  )`;
}

export function rawConnectedStoreAccountOrderScopePredicate(clientIds: number[]): SQL | undefined {
  if (!clientIds.length) return undefined;
  const syntheticStoreMatch = syntheticStoreIdMatchSql(sql`o.store_id`);
  return sql`exists (
    select 1
    from store_accounts scoped_store_account
    where scoped_store_account.client_id = any(${intArrayLiteral(clientIds)})
      and (
        (
          o.source_provider = scoped_store_account.provider
          and (
            o.source_account_id = 'store-account:' || scoped_store_account.id::text
            or o.source_account_id = scoped_store_account.id::text
          )
        )
        or ${syntheticStoreMatch}
      )
  )`;
}

export function clientScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  if (!scope.clientIds.length) return sql`false`;
  return inArray(clients.id, scope.clientIds);
}

export function clientFilterPredicate(scope: ClientPortalScope, clientId?: number | null, storeId?: number | null): SQL | undefined {
  return and(
    clientScopePredicate(scope),
    clientId ? eq(clients.id, clientId) : undefined,
    storeId ? sql`${clients.storeIds} && ${intArrayLiteral([storeId])}` : undefined,
  );
}

export function activeClientPredicate(orderTable: typeof orders = orders): SQL {
  return sql`(
    ${orderTable.clientId} in (
      select active_client.id
      from ${clients} active_client
      where coalesce(active_client.active, true) = true
    )
    or (
      ${orderTable.clientId} is null
      and ${orderTable.storeId} is not null
      and exists (
        select 1
        from ${clients} active_client
        where coalesce(active_client.active, true) = true
          and active_client.store_ids && array[${orderTable.storeId}]::int[]
      )
    )
  )`;
}

export function visibleAwaitingOrdersPredicate(orderTable: typeof orders = orders): SQL {
  return sql`not (
    (
      coalesce(${orderTable.orderNumber}, '') ilike 'SEAuto-%'
      or coalesce(${orderTable.raw}->>'orderNumber', '') ilike 'SEAuto-%'
      or coalesce(${orderTable.raw}->>'orderKey', '') ilike 'SEAuto-%'
    )
    and jsonb_array_length(
      case when jsonb_typeof(${orderTable.items}) = 'array' then ${orderTable.items} else '[]'::jsonb end
    ) = 0
    and coalesce((${orderTable.orderTotal})::numeric, 0) = 0
    and not exists (
      select 1
      from order_items visible_item
      where visible_item.order_id = ${orderTable.id}
        and coalesce(visible_item.quantity, 0) > 0
        and (
          trim(coalesce(visible_item.sku, '')) <> ''
          or trim(coalesce(visible_item.name, '')) <> ''
        )
    )
  )`;
}

export function orderSearchPredicate(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(orders.orderNumber, pattern),
    ilike(orders.externalOrderId, pattern),
    ilike(orders.shipToName, pattern),
    ilike(orders.customerEmail, pattern),
    ilike(orders.shipToCity, pattern),
    ilike(orders.shipToState, pattern),
    ilike(orders.carrierCode, pattern),
    ilike(orders.serviceCode, pattern),
    ilike(clients.name, pattern),
    sql`${orders.id}::text ilike ${pattern}`,
    sql`exists (
      select 1
      from ${orderItems} order_search_item
      where order_search_item.order_id = ${orders.id}
        and (
          order_search_item.sku ilike ${pattern}
          or order_search_item.name ilike ${pattern}
        )
    )`,
    sql`exists (
      select 1
      from ${shipments} order_search_shipment
      where order_search_shipment.order_id = ${orders.id}
        and (
          order_search_shipment.tracking_number ilike ${pattern}
          or order_search_shipment.label_tracking ilike ${pattern}
        )
    )`,
  );
}

export function shipmentSearchPredicate(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(shipments.trackingNumber, pattern),
    ilike(shipments.labelTracking, pattern),
    ilike(shipments.carrierCode, pattern),
    ilike(shipments.serviceCode, pattern),
    ilike(clients.name, pattern),
    ilike(orders.orderNumber, pattern),
    ilike(orders.externalOrderId, pattern),
    sql`${shipments.id}::text ilike ${pattern}`,
  );
}

export function visibleClientPortalShipmentsPredicate(): SQL {
  return sql`not (
    ${shipments.orderId} is null
    and ${shipments.clientId} is null
    and coalesce(${shipments.orderNumber}, '') ilike 'SEAuto-%'
  )`;
}

export function inventorySearchPredicate(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(inventory.sku, pattern),
    ilike(inventory.name, pattern),
    ilike(clients.name, pattern),
    sql`${inventory.id}::text ilike ${pattern}`,
  );
}

export function orderScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  // Explicit client/store filter from the top-bar switcher. Honored for EVERY
  // caller — global admins included — because it can only ever NARROW the result
  // set, never widen it. (Previously global admins bailed before this ran, so
  // the Dashboard switcher was a no-op for them.)
  const explicit = and(
    filters.clientId ? eq(orders.clientId, filters.clientId) : undefined,
    filters.storeId ? eq(orders.storeId, filters.storeId) : undefined,
  );
  // Unrestricted (global) callers see everything, narrowed only by `explicit`.
  if (!scope.isRestricted) return explicit;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) {
    predicates.push(inArray(orders.clientId, scope.clientIds));
    const connectedStorePredicate = connectedStoreAccountOrderScopePredicate(scope.clientIds);
    if (connectedStorePredicate) predicates.push(connectedStorePredicate);
  }
  if (scope.storeIds.length) predicates.push(inArray(orders.storeId, scope.storeIds));
  if (!predicates.length) return sql`false`;
  const scopePredicate = predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
  // Restricted callers stay bounded by their scope AND any explicit narrowing.
  return and(scopePredicate, explicit);
}

// Raw counterpart of orderScopePredicate, bound to the orders table aliased
// `o`. Used by analytics SQL (e.g. /analysis/sku-orders) that scans
// order_items joined to `orders o` rather than the drizzle `orders` ref.
// Returns undefined when the session is unrestricted (full visibility).
export function rawOrderScopeForAlias(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) {
    predicates.push(sql`o.client_id = any(${intArrayLiteral(scope.clientIds)})`);
    const connectedStorePredicate = rawConnectedStoreAccountOrderScopePredicate(scope.clientIds);
    if (connectedStorePredicate) predicates.push(connectedStorePredicate);
  }
  if (scope.storeIds.length) predicates.push(sql`o.store_id = any(${intArrayLiteral(scope.storeIds)})`);
  if (!predicates.length) return sql`false`;
  const scopePredicate = predicates.length === 1 ? predicates[0]! : sql`(${sql.join(predicates, sql` or `)})`;
  const extra: SQL[] = [scopePredicate];
  if (filters.clientId) extra.push(sql`o.client_id = ${filters.clientId}`);
  if (filters.storeId) extra.push(sql`o.store_id = ${filters.storeId}`);
  return extra.length === 1 ? extra[0]! : sql`(${sql.join(extra, sql` and `)})`;
}

export function inventoryScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(inArray(inventory.clientId, scope.clientIds));
  if (scope.storeIds.length) {
    predicates.push(sql`exists (
      select 1 from ${clients} scoped_client
      where scoped_client.id = ${inventory.clientId}
        and scoped_client.store_ids && ${intArrayLiteral(scope.storeIds)}
    )`);
  }
  if (!predicates.length) return sql`false`;
  const scopePredicate = predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
  return and(
    scopePredicate,
    filters.clientId ? eq(inventory.clientId, filters.clientId) : undefined,
    filters.storeId
      ? sql`exists (
          select 1 from ${clients} filtered_client
          where filtered_client.id = ${inventory.clientId}
            and filtered_client.store_ids && ${intArrayLiteral([filters.storeId])}
        )`
      : undefined,
  );
}

export function shipmentScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  // Explicit switcher filter — narrows only, so safe for global admins too.
  const explicit = and(
    filters.clientId ? eq(shipments.clientId, filters.clientId) : undefined,
    filters.storeId
      ? sql`exists (
          select 1 from ${orders} filtered_order
          where filtered_order.id = ${shipments.orderId}
            and filtered_order.store_id = ${filters.storeId}
        )`
      : undefined,
  );
  if (!scope.isRestricted) return explicit;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(inArray(shipments.clientId, scope.clientIds));
  if (scope.storeIds.length) {
    predicates.push(sql`exists (
      select 1 from ${orders} scoped_order
      where scoped_order.id = ${shipments.orderId}
        and scoped_order.store_id in (${sql.join(scope.storeIds.map((id) => sql`${id}`), sql`, `)})
    )`);
  }
  if (!predicates.length) return sql`false`;
  const scopePredicate = predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
  return and(scopePredicate, explicit);
}

export function invoiceLineScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(sql`b.client_id in (${sql.join(scope.clientIds.map((id) => sql`${id}`), sql`, `)})`);
  if (scope.storeIds.length) {
    predicates.push(sql`exists (
      select 1 from ${orders} scoped_order
      where scoped_order.id = b.order_id
        and scoped_order.store_id in (${sql.join(scope.storeIds.map((id) => sql`${id}`), sql`, `)})
    )`);
  }
  if (!predicates.length) return sql`false`;
  return predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
}

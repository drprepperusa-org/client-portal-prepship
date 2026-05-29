import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { carrierAccountClients, carrierAccounts } from '../db/schema/carrier-accounts';
import { clients } from '../db/schema/clients';
import { inventory } from '../db/schema/inventory';
import { orderItems } from '../db/schema/order-items';
import { orderOverrides, orders } from '../db/schema/orders';
import { settings } from '../db/schema/settings';
import { shipments } from '../db/schema/shipments';
import { billingSummary } from '../services/billing';
import { getSkuOrdersForSku } from '../services/sku-orders';
import { getSkuBreakdownFromOrderItems } from './analysis';
import {
  HERITAGE_PREP_FEE_CLIENT_NAME,
  heritagePrepFeeRowsForRange,
} from '../lib/heritage-prep-fee-overrides';
import { getSyncStatus } from '../services/order-sync';
import { getShipmentSyncStatus } from '../services/shipment-sync';
import { getPersistedWorkerStatus } from '../services/worker-status';
import { isAdminEmail } from '../lib/admin-emails';
import {
  toPortalIntegrationDto,
  toPortalInventoryDto,
  toPortalOrderDto,
  toPortalShipmentDto,
} from '../lib/client-portal/dto';
import { recordPortalAudit } from '../lib/client-portal/audit';
import {
  assertClientPortalScope,
  isClientPortalScope,
  type ClientPortalScope,
} from '../lib/client-portal/scope';

const app = new Hono();

function parsePage(value: string | undefined, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value: string | undefined, fallback = 25, max = 200) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asTimestamp(value: Date) {
  return value.toISOString();
}

function liveAwaitingSince() {
  return new Date(Date.now() - 30 * 86_400_000);
}

function intArrayLiteral(values: number[]) {
  return sql`array[${sql.join(values.map((id) => sql`${id}`), sql`, `)}]::int[]`;
}

function requestedClientId(c: Context) {
  return parsePositiveInt(c.req.query('clientId'));
}

function requestedStoreId(c: Context) {
  return parsePositiveInt(c.req.query('storeId'));
}

function requestedSearch(c: Context) {
  const value = c.req.query('search')?.trim();
  return value ? value.slice(0, 120) : '';
}

function clientScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  if (!scope.clientIds.length) return sql`false`;
  return inArray(clients.id, scope.clientIds);
}

function clientFilterPredicate(scope: ClientPortalScope, clientId?: number | null, storeId?: number | null): SQL | undefined {
  return and(
    clientScopePredicate(scope),
    clientId ? eq(clients.id, clientId) : undefined,
    storeId ? sql`${clients.storeIds} && ${intArrayLiteral([storeId])}` : undefined,
  );
}

function activeClientPredicate(orderTable: typeof orders = orders): SQL {
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

function visibleAwaitingOrdersPredicate(orderTable: typeof orders = orders): SQL {
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

function orderSearchPredicate(search: string): SQL | undefined {
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

function shipmentSearchPredicate(search: string): SQL | undefined {
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

function inventorySearchPredicate(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(inventory.sku, pattern),
    ilike(inventory.name, pattern),
    ilike(clients.name, pattern),
    sql`${inventory.id}::text ilike ${pattern}`,
  );
}

function orderScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(inArray(orders.clientId, scope.clientIds));
  if (scope.storeIds.length) predicates.push(inArray(orders.storeId, scope.storeIds));
  if (!predicates.length) return sql`false`;
  const scopePredicate = predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
  return and(
    scopePredicate,
    filters.clientId ? eq(orders.clientId, filters.clientId) : undefined,
    filters.storeId ? eq(orders.storeId, filters.storeId) : undefined,
  );
}

// Raw counterpart of orderScopePredicate, bound to the orders table aliased
// `o`. Used by analytics SQL (e.g. /analysis/sku-orders) that scans
// order_items joined to `orders o` rather than the drizzle `orders` ref.
// Returns undefined when the session is unrestricted (full visibility).
function rawOrderScopeForAlias(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(sql`o.client_id = any(${intArrayLiteral(scope.clientIds)})`);
  if (scope.storeIds.length) predicates.push(sql`o.store_id = any(${intArrayLiteral(scope.storeIds)})`);
  if (!predicates.length) return sql`false`;
  const scopePredicate = predicates.length === 1 ? predicates[0]! : sql`(${sql.join(predicates, sql` or `)})`;
  const extra: SQL[] = [scopePredicate];
  if (filters.clientId) extra.push(sql`o.client_id = ${filters.clientId}`);
  if (filters.storeId) extra.push(sql`o.store_id = ${filters.storeId}`);
  return extra.length === 1 ? extra[0]! : sql`(${sql.join(extra, sql` and `)})`;
}

function inventoryScopePredicate(
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

function shipmentScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {}
): SQL | undefined {
  if (!scope.isRestricted) return undefined;
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
  return and(
    scopePredicate,
    filters.clientId ? eq(shipments.clientId, filters.clientId) : undefined,
    filters.storeId
      ? sql`exists (
          select 1 from ${orders} filtered_order
          where filtered_order.id = ${shipments.orderId}
            and filtered_order.store_id = ${filters.storeId}
        )`
      : undefined,
  );
}

function scopeOrResponse(c: Context) {
  const scope = assertClientPortalScope(c);
  return isClientPortalScope(scope) ? scope : scope;
}

type PortalInvoiceDetailRow = {
  client_id: number;
  client_name: string | null;
  order_id: number | null;
  order_number: string | null;
  recipient_name: string | null;
  item_names: string | null;
  ship_date: string | null;
  qty: string;
  pickpack_total: string;
  additional_total: string;
  package_total: string;
  shipping_total: string;
  storage_total: string;
  row_total: string;
};

function invoiceLineScopePredicate(scope: ClientPortalScope): SQL | undefined {
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

async function portalInvoiceDetails(scope: ClientPortalScope, input: { clientId?: number | null; dateFrom: string; dateTo: string }) {
  if (input.clientId) {
    const [client] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(clientFilterPredicate(scope, input.clientId, null))
      .limit(1);
    if (client?.name === HERITAGE_PREP_FEE_CLIENT_NAME) {
      const overrideRows = heritagePrepFeeRowsForRange(input.dateFrom, input.dateTo);
      if (overrideRows.length > 0) {
        return overrideRows.map((row) => ({
          clientId: client.id,
          clientName: client.name,
          orderId: null,
          orderNumber: row.orderNumber,
          recipientName: row.recipientName,
          itemNames: row.itemNames,
          shipDate: row.shipDate,
          qty: row.qty.toFixed(3),
          pickpackTotal: row.pickpackTotal.toFixed(2),
          additionalTotal: '0.00',
          packageTotal: row.packageTotal.toFixed(2),
          shippingTotal: row.shippingTotal.toFixed(2),
          storageTotal: row.storageTotal.toFixed(2),
          rowTotal: row.rowTotal.toFixed(2),
        }));
      }
    }
  }

  const rows = await db.execute<PortalInvoiceDetailRow>(sql`
    select
      b.client_id,
      c.name as client_name,
      b.order_id,
      b.order_number,
      max(o.ship_to_name) as recipient_name,
      (
        select string_agg(distinct oi.name, ' | ')
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.name is not null
          and oi.name <> ''
      ) as item_names,
      to_char(min(b.ship_date)::date, 'YYYY-MM-DD') as ship_date,
      coalesce((
        select sum(greatest(0, coalesce(oi.quantity, 0)))
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.quantity > 0
      ), 0)::text as qty,
      coalesce(sum(case when b.line_type in ('pick_pack', 'pickpack') then b.total_cost else 0 end), 0)::text as pickpack_total,
      coalesce(sum(case when b.line_type in ('additional_unit', 'additional') then b.total_cost else 0 end), 0)::text as additional_total,
      coalesce(sum(case when b.line_type in ('package_cost', 'package') then b.total_cost else 0 end), 0)::text as package_total,
      coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)::text as shipping_total,
      coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end), 0)::text as storage_total,
      coalesce(sum(b.total_cost), 0)::text as row_total
    from billing_line_items b
    left join ${clients} c on c.id = b.client_id
    left join ${orders} o on o.id = b.order_id
    where coalesce(c.active, true) = true
      and b.ship_date >= ${input.dateFrom}::timestamptz
      and b.ship_date <= ${input.dateTo}::timestamptz
      ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
      ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
    group by b.client_id, c.name, b.order_id, b.order_number
    order by min(b.ship_date) desc, b.order_id desc
    limit 1000
  `);

  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    orderId: row.order_id,
    orderNumber: row.order_number,
    recipientName: row.recipient_name,
    itemNames: row.item_names,
    shipDate: row.ship_date,
    qty: row.qty,
    pickpackTotal: row.pickpack_total,
    additionalTotal: row.additional_total,
    packageTotal: row.package_total,
    shippingTotal: row.shipping_total,
    storageTotal: row.storage_total,
    rowTotal: row.row_total,
  }));
}

function escHtml(value: string | number | null | undefined): string {
  return value === null || value === undefined
    ? ''
    : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

app.get('/me', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.me.view', scope);
  return c.json({
    id: scope.userId || null,
    email: scope.email ?? null,
    role: scope.role ?? null,
    isAdmin: isAdminEmail(scope.email),
    isGlobal: scope.isGlobal,
    isRestricted: scope.isRestricted,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    permissions: scope.permissions,
    canViewFinancials: scope.canViewFinancials,
    canViewCredentials: scope.canViewCredentials,
  });
});

app.get('/dashboard', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('from')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('to')) ?? new Date();
  const where = and(
    orderScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) }),
    activeClientPredicate(),
    gte(orders.orderDate, from),
    lte(orders.orderDate, to)
  );
  const rows = await db.select().from(orders).where(where).limit(1000);
  const revenue = scope.canViewFinancials
    ? rows.reduce((sum, row) => sum + Number(row.orderTotal ?? 0), 0)
    : 0;
  const units = rows.reduce((sum, row) => sum + safeItemQty(row.items), 0);
  await recordPortalAudit('portal.dashboard.view', scope, { from, to, rows: rows.length });
  return c.json({
    revenue,
    units,
    bySku: topSkuRows(rows, scope.canViewFinancials),
    dailyRevenue: scope.canViewFinancials ? dailyRevenueRows(rows) : [],
  });
});

app.get('/daily-counts', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('from')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('to')) ?? new Date();
  const scopePredicate = orderScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) });
  const rows = await db.execute<{
    day: string;
    order_status: string;
    count: number;
  }>(sql`
    select to_char(order_date::date, 'YYYY-MM-DD') as day,
           order_status,
           count(*)::int as count
    from orders
    where order_date >= ${asTimestamp(from)}
      and order_date <= ${asTimestamp(to)}
      ${scopePredicate ? sql`and ${scopePredicate}` : sql``}
      and ${activeClientPredicate()}
    group by day, order_status
    order by day asc
  `);
  const byDay = new Map<string, { day: string; awaiting: number; shipped: number; cancelled: number; total: number }>();
  for (const row of rows) {
    const current = byDay.get(row.day) ?? { day: row.day, awaiting: 0, shipped: 0, cancelled: 0, total: 0 };
    current.total += row.count;
    if (row.order_status === 'awaiting_shipment') current.awaiting += row.count;
    if (row.order_status === 'shipped') current.shipped += row.count;
    if (row.order_status === 'cancelled') current.cancelled += row.count;
    byDay.set(row.day, current);
  }
  await recordPortalAudit('portal.dashboard.daily_counts', scope, { from, to });
  return c.json({ data: [...byDay.values()] });
});

app.get('/orders', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const status = c.req.query('status');
  const clientId = parsePositiveInt(c.req.query('clientId'));
  const storeId = parsePositiveInt(c.req.query('storeId'));
  const search = requestedSearch(c);
  const where = and(
    orderScopePredicate(scope, { clientId, storeId }),
    activeClientPredicate(),
    status ? eq(orders.orderStatus, status) : undefined,
    status === 'awaiting_shipment' ? visibleAwaitingOrdersPredicate() : undefined,
    orderSearchPredicate(search),
  );
  const rows = await db
    .select({
      order: orders,
      override: orderOverrides,
      clientName: clients.name,
      storeIds: clients.storeIds,
    })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(where)
    .orderBy(desc(orders.orderDate), desc(orders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.orders.list', scope, { status: status ?? 'all', page, pageSize, clientId, search });
  return c.json({
    data: rows.map((row) =>
      toPortalOrderDto(
        { ...row.order, clientName: row.clientName, storeName: row.clientName, override: row.override },
        { includeFinancials: scope.canViewFinancials },
      )
    ),
    pagination: {
      page,
      pageSize,
      total: Number(count),
      totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
    },
  });
});

app.get('/orders/awaiting-active-count', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const where = and(
    orderScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) }),
    activeClientPredicate(),
    eq(orders.orderStatus, 'awaiting_shipment'),
    visibleAwaitingOrdersPredicate(),
    gte(orders.orderDate, liveAwaitingSince()),
    eq(orders.externallyShipped, false),
    sql`coalesce((${orders.raw}->>'externallyFulfilled')::boolean, false) = false`,
    sql`jsonb_array_length(coalesce(${orders.items}, '[]'::jsonb)) > 0`,
    sql`not exists (
      select 1
      from ${shipments} active_shipment
      where active_shipment.order_id = ${orders.id}
        and active_shipment.voided = false
    )`,
  );
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);
  const count = Number(row?.count ?? 0);
  await recordPortalAudit('portal.orders.awaiting_active_count', scope, { count });
  return c.json({ count });
});

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

app.get('/orders/:id{[0-9]+}', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));
  const [row] = await db
    .select({ order: orders, override: orderOverrides, clientName: clients.name })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(and(eq(orders.id, id), orderScopePredicate(scope), activeClientPredicate()))
    .limit(1);
  if (!row) return c.json({ error: 'Order not found' }, 404);
  await recordPortalAudit('portal.orders.detail.view', scope, { orderId: id });
  return c.json({
    data: toPortalOrderDto(
      { ...row.order, clientName: row.clientName, storeName: row.clientName, override: row.override },
      { includeFinancials: scope.canViewFinancials },
    ),
  });
});

app.get('/shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const where = and(
    eq(shipments.voided, false),
    shipmentScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) }),
    shipmentSearchPredicate(search),
  );
  const rows = await db
    .select({
      shipment: shipments,
      clientName: clients.name,
      storeId: orders.storeId,
    })
    .from(shipments)
    .leftJoin(clients, eq(clients.id, shipments.clientId))
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .where(where)
    .orderBy(desc(shipments.shipDate), desc(shipments.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shipments)
    .leftJoin(clients, eq(clients.id, shipments.clientId))
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.shipments.list', scope, { page, pageSize, search });
  return c.json({
    data: rows.map((row) => toPortalShipmentDto({ ...row.shipment, clientName: row.clientName, storeName: row.clientName, storeId: row.storeId })),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

app.get('/inventory', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const where = and(
    eq(inventory.active, true),
    inventoryScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) }),
    inventorySearchPredicate(search),
  );
  const rows = await db
    .select({
      item: inventory,
      clientName: clients.name,
      storeIds: clients.storeIds,
    })
    .from(inventory)
    .leftJoin(clients, eq(clients.id, inventory.clientId))
    .where(where)
    .orderBy(desc(inventory.updatedAt), desc(inventory.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventory)
    .leftJoin(clients, eq(clients.id, inventory.clientId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.inventory.list', scope, { page, pageSize, search });
  return c.json({
    data: rows.map((row) => toPortalInventoryDto({ ...row.item, clientName: row.clientName, storeName: row.clientName, storeIds: row.storeIds })),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

app.get('/analysis', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const to = parseDate(c.req.query('dateTo')) ?? new Date();
  const from = parseDate(c.req.query('dateFrom')) ?? new Date(to.getTime() - 29 * 86_400_000);
  const limit = parsePageSize(c.req.query('limit'), 200, 2000);
  const result = await getSkuBreakdownFromOrderItems({
    dateFrom: asTimestamp(from),
    dateTo: asTimestamp(to),
    limit,
    clientId: requestedClientId(c) ?? undefined,
    storeId: requestedStoreId(c) ?? undefined,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
    canViewFinancials: scope.canViewFinancials,
    hideTestOrders: false,
    includeCancelled: false,
  });
  await recordPortalAudit('portal.analysis.view', scope);
  return c.json({
    data: result.rows,
    dateBuckets: result.dateBuckets,
    totalSkus: result.totalSkus,
    totalOrders: result.totalOrders,
  });
});

// Per-SKU "Recent Orders" payload for the Analysis page detail drawer.
// Portal counterpart of the operator GET /inventory/:id/sku-orders route —
// it resolves the inventory row *within the caller's scope* (so a client can
// only inspect their own SKUs) and feeds the shared READ-only analytics
// helper a tenant-scoped order predicate.
app.get('/analysis/sku-orders', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const inventoryId = parsePositiveInt(c.req.query('inventoryId') ?? c.req.query('invSkuId'));
  if (!inventoryId) return c.json({ error: 'inventoryId is required' }, 400);

  const to = parseDate(c.req.query('dateTo')) ?? new Date();
  const from = parseDate(c.req.query('dateFrom')) ?? new Date(to.getTime() - 29 * 86_400_000);
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);

  const [item] = await db
    .select({ sku: inventory.sku, name: inventory.name, clientId: inventory.clientId })
    .from(inventory)
    .where(and(eq(inventory.id, inventoryId), inventoryScopePredicate(scope, { clientId, storeId })))
    .limit(1);
  if (!item) return c.json({ error: 'Inventory item not found' }, 404);

  const result = await getSkuOrdersForSku({
    sku: item.sku,
    name: item.name,
    clientId: item.clientId,
    dateFrom: asTimestamp(from),
    dateTo: asTimestamp(to),
    canViewFinancials: scope.canViewFinancials,
    orderScopeSql: rawOrderScopeForAlias(scope, { clientId, storeId }),
  });

  await recordPortalAudit('portal.analysis.sku_orders', scope, { inventoryId, orders: result.orders.length });
  return c.json(result);
});

app.get('/daily-shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('dateFrom')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('dateTo')) ?? new Date();
  const scopePredicate = shipmentScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) });
  const rows = await db.execute<{ day: string; shipments: number }>(sql`
    select to_char(ship_date::date, 'YYYY-MM-DD') as day,
           count(*)::int as shipments
    from shipments
    where coalesce(voided, false) = false
      and ship_date >= ${asTimestamp(from)}
      and ship_date <= ${asTimestamp(to)}
      ${scopePredicate ? sql`and ${scopePredicate}` : sql``}
    group by day
    order by day asc
  `);
  await recordPortalAudit('portal.analysis.daily_shipments', scope, { from, to });
  return c.json({ data: rows });
});

app.get('/reports', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.reports.denied', scope);
    return c.json({ data: [], grandTotal: 0, billingVisible: false });
  }
  const dateFrom = c.req.query('dateFrom') ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const dateTo = c.req.query('dateTo') ?? new Date().toISOString();
  const summary = await billingSummary({
    clientId: requestedClientId(c) ?? undefined,
    dateFrom,
    dateTo,
    scopeClientIds: scope.clientIds,
    scopeStoreIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
  });
  await recordPortalAudit('portal.reports.view', scope, { rows: summary.clients.length });
  return c.json({ data: summary.clients, clients: summary.clients, grandTotal: summary.grandTotal, billingVisible: true });
});

app.get('/invoice-details', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.invoice_details.denied', scope);
    return c.json({ data: [], billingVisible: false }, 403);
  }
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if (!dateFrom || !dateTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  const clientId = requestedClientId(c);
  const rows = await portalInvoiceDetails(scope, { clientId, dateFrom, dateTo });
  await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: rows.length });
  return c.json({ data: rows, billingVisible: true });
});

app.get('/invoice', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.text('Invoice visibility required', 403);
  const clientId = requestedClientId(c);
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if (!clientId || !dateFrom || !dateTo) return c.text('clientId, dateFrom, and dateTo are required', 400);
  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(clientFilterPredicate(scope, clientId, requestedStoreId(c)))
    .limit(1);
  if (!client) return c.text('Client not found', 404);
  const summary = await billingSummary({
    clientId,
    dateFrom,
    dateTo,
    scopeClientIds: scope.clientIds,
    scopeStoreIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
  });
  const row = summary.clients[0];
  const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
  const details = await portalInvoiceDetails(scope, { clientId, dateFrom, dateTo });
  const detailTotals = details.reduce(
    (totals, detail) => ({
      orderCount: totals.orderCount + 1,
      qty: totals.qty + Number(detail.qty ?? 0),
      pickPackTotal: totals.pickPackTotal + Number(detail.pickpackTotal ?? 0),
      additionalTotal: totals.additionalTotal + Number(detail.additionalTotal ?? 0),
      packageTotal: totals.packageTotal + Number(detail.packageTotal ?? 0),
      shippingTotal: totals.shippingTotal + Number(detail.shippingTotal ?? 0),
      storageTotal: totals.storageTotal + Number(detail.storageTotal ?? 0),
      grandTotal: totals.grandTotal + Number(detail.rowTotal ?? 0),
    }),
    {
      orderCount: 0,
      qty: 0,
      pickPackTotal: 0,
      additionalTotal: 0,
      packageTotal: 0,
      shippingTotal: 0,
      storageTotal: 0,
      grandTotal: 0,
    },
  );
  const invoiceTotals = details.length > 0 ? detailTotals : {
    orderCount: row?.orderCount ?? 0,
    qty: 0,
    pickPackTotal: Number(row?.pickPackTotal ?? 0),
    additionalTotal: Number(row?.additionalTotal ?? 0),
    packageTotal: Number(row?.packageTotal ?? 0),
    shippingTotal: Number(row?.shippingTotal ?? 0),
    storageTotal: Number(row?.storageTotal ?? 0),
    grandTotal: Number(row?.grandTotal ?? 0),
  };
  const fromDisplay = dateFrom.slice(0, 10);
  const toDisplay = dateTo.slice(0, 10);
  const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const detailRows = details
    .map((detail) => `
      <tr>
        <td>${escHtml(detail.shipDate)}</td>
        <td class="mono">${escHtml(detail.orderNumber ?? detail.orderId ?? '')}</td>
        <td>${escHtml(detail.recipientName ?? '')}</td>
        <td>${escHtml(detail.itemNames ?? '')}</td>
        <td class="num">${Number(detail.qty ?? 0)}</td>
        <td class="num">${money(detail.pickpackTotal)}</td>
        <td class="num">${Number(detail.additionalTotal ?? 0) > 0 ? money(detail.additionalTotal) : '-'}</td>
        <td class="num">${Number(detail.packageTotal ?? 0) > 0 ? money(detail.packageTotal) : '-'}</td>
        <td class="num">${Number(detail.shippingTotal ?? 0) > 0 ? money(detail.shippingTotal) : '-'}</td>
        <td class="num bold">${money(detail.rowTotal)}</td>
      </tr>`)
    .join('');
  return c.html(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PrepShip Invoice - ${escHtml(client.name)} - ${fromDisplay} to ${toDisplay}</title>
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;margin:0 auto;max-width:1120px;padding:40px 48px;color:#111827;background:#fff;font-size:13px}.print-tip{margin-bottom:24px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:10px 14px}.header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #e5e7eb;padding-bottom:20px;margin-bottom:22px}.brand h1{font-size:28px;line-height:1;margin:0 0 6px;font-weight:800}.muted{color:#6b7280}.client{text-align:right}.client strong{display:block;font-size:18px}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:22px 0}.card{border:1px solid #e5e7eb;border-radius:10px;padding:12px}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;font-weight:800}.value{margin-top:4px;font-size:17px;font-weight:800}.total{display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1px solid #86efac;color:#166534;border-radius:10px;padding:14px 18px;margin-bottom:24px}.total b{font-size:24px}table{width:100%;border-collapse:collapse}th{background:#f9fafb;color:#374151;text-transform:uppercase;font-size:10px;letter-spacing:.06em}td,th{border:1px solid #e5e7eb;padding:8px 10px;text-align:left}tbody tr:nth-child(even){background:#fafafa}.num{text-align:right}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#2563eb}.bold{font-weight:800}tfoot td{font-weight:800;background:#f3f4f6}.footer{border-top:1px solid #e5e7eb;color:#9ca3af;margin-top:24px;padding-top:12px;text-align:center;font-size:11px}@media print{.print-tip{display:none}body{padding:18px;max-width:none}}
  </style>
</head>
<body>
  <div class="print-tip">To save as PDF: press <strong>Ctrl+P</strong>, then choose <strong>Save as PDF</strong>.</div>
  <div class="header">
    <div class="brand"><h1>PrepShip Invoice</h1><div class="muted">DR Prepper 3PL Services</div><div class="muted">Generated ${escHtml(generated)}</div></div>
    <div class="client"><strong>${escHtml(client.name)}</strong><span class="muted">${fromDisplay} to ${toDisplay}</span></div>
  </div>
  <div class="summary">
    <div class="card"><div class="label">Orders</div><div class="value">${invoiceTotals.orderCount}</div></div>
    <div class="card"><div class="label">Qty</div><div class="value">${invoiceTotals.qty}</div></div>
    <div class="card"><div class="label">Pick/pack</div><div class="value">${money(invoiceTotals.pickPackTotal)}</div></div>
    <div class="card"><div class="label">Box fee</div><div class="value">${money(invoiceTotals.packageTotal)}</div></div>
    <div class="card"><div class="label">Shipping</div><div class="value">${money(invoiceTotals.shippingTotal)}</div></div>
    <div class="card"><div class="label">Storage</div><div class="value">${money(invoiceTotals.storageTotal)}</div></div>
  </div>
  <div class="total"><span>Total amount due</span><b>${money(invoiceTotals.grandTotal)}</b></div>
  <table>
    <thead><tr><th>Ship date</th><th>Order</th><th>Recipient</th><th>Item name</th><th class="num">Qty</th><th class="num">Pick/pack</th><th class="num">Additional</th><th class="num">Box fee</th><th class="num">Shipping</th><th class="num">Row total</th></tr></thead>
    <tbody>${detailRows || '<tr><td colspan="10">No billable order rows found for this period.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5">${invoiceTotals.orderCount} orders / ${invoiceTotals.qty} qty</td><td class="num">${money(invoiceTotals.pickPackTotal)}</td><td class="num">${money(invoiceTotals.additionalTotal)}</td><td class="num">${money(invoiceTotals.packageTotal)}</td><td class="num">${money(invoiceTotals.shippingTotal)}</td><td class="num">${money(invoiceTotals.grandTotal)}</td></tr></tfoot>
  </table>
  <div class="footer">PrepShip invoice generated ${escHtml(generated)} for ${escHtml(client.name)}.</div>
</body>
</html>`);
});

app.get('/clients', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const rows = await db
    .select({ id: clients.id, name: clients.name, email: clients.email, active: clients.active, storeIds: clients.storeIds })
    .from(clients)
    .where(and(eq(clients.active, true), clientFilterPredicate(scope, requestedClientId(c), requestedStoreId(c))))
    .orderBy(clients.name)
    .limit(200);
  await recordPortalAudit('portal.clients.list', scope, { rows: rows.length });
  return c.json({ data: rows });
});

app.get('/settings', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    await recordPortalAudit('portal.settings.scoped_empty', scope);
    return c.json({ data: [] });
  }
  const rows = await db.select().from(settings).limit(200);
  await recordPortalAudit('portal.settings.list', scope, { rows: rows.length });
  return c.json({ data: rows });
});

app.get('/sync-status', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const [orderStatus, shipmentStatus, worker] = await Promise.all([
    getSyncStatus({ includeOrderCount: false }),
    getShipmentSyncStatus({ includeShipmentCount: false }),
    getPersistedWorkerStatus(),
  ]);
  return c.json({
    status: orderStatus.lastSyncedAt ? 'done' : 'idle',
    lastSyncAt: orderStatus.lastSyncedAt,
    orders: orderStatus,
    shipments: shipmentStatus,
    worker,
    queue: { enabled: false, started: false },
  });
});

app.post('/backfill', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return c.json({ error: 'Backfill is disabled on the client portal API. Use the PrepShip stable admin API.' }, 403);
});

app.get('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const carrierRows = await db
    .select({
      id: carrierAccounts.id,
      clientId: carrierAccounts.clientId,
      provider: carrierAccounts.provider,
      label: carrierAccounts.label,
      accountIdentifier: carrierAccounts.accountIdentifier,
      source: carrierAccounts.source,
      active: carrierAccounts.active,
      createdAt: carrierAccounts.createdAt,
      updatedAt: carrierAccounts.updatedAt,
      assignedClientId: carrierAccountClients.clientId,
    })
    .from(carrierAccounts)
    .leftJoin(carrierAccountClients, eq(carrierAccountClients.carrierAccountId, carrierAccounts.id))
    .where(and(eq(carrierAccounts.active, true), carrierScopePredicate(scope)));

  const byId = new Map<number, ReturnType<typeof toPortalIntegrationDto>>();
  for (const row of carrierRows) {
    const existing = byId.get(row.id);
    const assignedClientIds = [
      ...(existing?.assignedClientIds ?? []),
      ...(row.assignedClientId ? [row.assignedClientId] : []),
    ];
    byId.set(row.id, toPortalIntegrationDto({ ...row, type: 'carrier', assignedClientIds }));
  }

  const storeRows = await storeAccountRows(scope);
  await recordPortalAudit('portal.integrations.list', scope, { carriers: byId.size, stores: storeRows.length });
  return c.json({ data: [...storeRows, ...byId.values()] });
});

app.get('/activity', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.activity.view', scope);
  return c.json({ data: [] });
});

function carrierScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) {
    predicates.push(inArray(carrierAccounts.clientId, scope.clientIds));
    predicates.push(inArray(carrierAccountClients.clientId, scope.clientIds));
  }
  if (!predicates.length) return sql`false`;
  return or(...predicates) ?? sql`false`;
}

async function storeAccountRows(scope: ClientPortalScope) {
  try {
    const rows = await db.execute<{
      id: number;
      clientId: number | null;
      provider: string | null;
      label: string | null;
      accountIdentifier: string | null;
      source: string | null;
      active: boolean | null;
      createdAt: Date | string | null;
      updatedAt: Date | string | null;
    }>(sql`
      select id,
             client_id as "clientId",
             provider,
             label,
             account_identifier as "accountIdentifier",
             source,
             active,
             created_at as "createdAt",
             updated_at as "updatedAt"
      from store_accounts
      where coalesce(active, true) = true
        ${scope.isRestricted && scope.clientIds.length ? sql`and client_id in (${sql.join(scope.clientIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
      order by created_at desc
      limit 200
    `);
    return rows.map((row) => toPortalIntegrationDto({ ...row, type: 'store' }));
  } catch (err) {
    console.warn('[client-portal] store account list unavailable:', err);
    return [];
  }
}

function safeItemQty(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    const qty = Number((item as Record<string, unknown>).quantity ?? (item as Record<string, unknown>).qty ?? 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

function topSkuRows(rows: Array<typeof orders.$inferSelect>, canViewFinancials = false) {
  const bySku = new Map<string, { sku: string; units30: number; units7: number; revenue: number }>();
  for (const row of rows) {
    if (!Array.isArray(row.items)) continue;
    for (const item of row.items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const sku = typeof record.sku === 'string' && record.sku.trim() ? record.sku : 'unknown';
      const qty = Number(record.quantity ?? record.qty ?? 0);
      const current = bySku.get(sku) ?? { sku, units30: 0, units7: 0, revenue: 0 };
      current.units30 += Number.isFinite(qty) ? qty : 0;
      if (canViewFinancials) {
        const unitPrice = Number(record.unitPrice ?? record.unit_price ?? 0);
        current.revenue += (Number.isFinite(unitPrice) ? unitPrice : 0) * (Number.isFinite(qty) ? qty : 0);
      }
      bySku.set(sku, current);
    }
  }
  return [...bySku.values()].sort((a, b) => b.units30 - a.units30).slice(0, 10);
}

function dailyRevenueRows(rows: Array<typeof orders.$inferSelect>) {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(row.orderDate);
    if (!key) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + Number(row.orderTotal ?? 0));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, revenue]) => ({ day, revenue }));
}

function dayKey(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export default app;

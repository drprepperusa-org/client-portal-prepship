import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { carrierAccountClients, carrierAccounts } from '../db/schema/carrier-accounts';
import { clients } from '../db/schema/clients';
import { inventory, inventoryLedger } from '../db/schema/inventory';
import { packages } from '../db/schema/packages';
import { orderItems } from '../db/schema/order-items';
import { orderOverrides, orders } from '../db/schema/orders';
import { inboundShipments, inboundItems } from '../db/schema/inbound';
import { applyMovement } from '../services/inventory';
import { settings } from '../db/schema/settings';
import { shipments } from '../db/schema/shipments';
import { billingSummary, generateLineItems } from '../services/billing';
import { getSkuOrdersForSku } from '../services/sku-orders';
import { getSkuBreakdownFromOrderItems } from './analysis';
import {
  HERITAGE_PREP_FEE_CLIENT_NAME,
  heritagePrepFeeRowsForRange,
} from '../lib/heritage-prep-fee-overrides';
import { getSyncStatus } from '../services/order-sync';
import { getShipmentSyncStatus } from '../services/shipment-sync';
import { getPersistedWorkerStatus } from '../services/worker-status';
import {
  startBackfillBestRates,
  getActiveBackfillJob,
  getLatestBackfillJob,
  type BackfillJob,
} from '../services/rates-backfill';
import { getProviderAccountNicknames, listMarkupCarrierGroups } from '../services/rates';
import { isAdminEmail } from '../lib/admin-emails';
import { supabaseAdmin } from '../lib/supabase';
import {
  toPortalInboundDto,
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

function normalizeMetadataIds(value: unknown): number[] {
  const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      raw
        .map((item) => Number(item))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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
  skus: string | null;
  carrier_code: string | null;
  best_rate_dims: string | null;
  dim_l: string | null;
  dim_w: string | null;
  dim_h: string | null;
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
          skus: null,
          carrierCode: null,
          boxSize: null,
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
      (
        select string_agg(distinct oi.sku, ', ')
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.sku is not null
          and oi.sku <> ''
      ) as skus,
      max(o.carrier_code) as carrier_code,
      max(oo.best_rate_dims) as best_rate_dims,
      max(o.raw->'dimensions'->>'length') as dim_l,
      max(o.raw->'dimensions'->>'width') as dim_w,
      max(o.raw->'dimensions'->>'height') as dim_h,
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
    left join ${orderOverrides} oo on oo.order_id = b.order_id
    where coalesce(c.active, true) = true
      and b.ship_date >= ${input.dateFrom}::timestamptz
      and b.ship_date <= ${input.dateTo}::timestamptz
      ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
      ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
    group by b.client_id, c.name, b.order_id, b.order_number
    order by min(b.ship_date) desc, b.order_id desc
    limit 1000
  `);

  const dimsFromRaw = (l: string | null, w: string | null, h: string | null): string | null => {
    const nl = Number(l);
    const nw = Number(w);
    const nh = Number(h);
    if ([nl, nw, nh].every((n) => Number.isFinite(n) && n > 0)) return `${nl}x${nw}x${nh}`;
    return null;
  };

  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    orderId: row.order_id,
    orderNumber: row.order_number,
    recipientName: row.recipient_name,
    itemNames: row.item_names,
    skus: row.skus,
    carrierCode: row.carrier_code,
    boxSize: row.best_rate_dims ?? dimsFromRaw(row.dim_l, row.dim_w, row.dim_h),
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
      // Active (non-voided) shipment's billed account for this order — drives
      // the "Shipping Account" column for shipped/cancelled orders.
      shipAcctNickname: sql<string | null>`(
        select ${shipments.providerAccountNickname} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipAcctId: sql<number | null>`(
        select ${shipments.providerAccountId} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
          and ${shipments.providerAccountId} is not null
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
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
  // Resolve numeric account ids → nicknames (cached carrier list + curated map).
  const accountNicknames = await getProviderAccountNicknames().catch(() => new Map<number, string>());
  await recordPortalAudit('portal.orders.list', scope, { status: status ?? 'all', page, pageSize, clientId, search });
  return c.json({
    data: rows.map((row) => {
      const shipmentAccount =
        row.shipAcctNickname ?? (row.shipAcctId != null ? accountNicknames.get(row.shipAcctId) ?? null : null);
      return toPortalOrderDto(
        { ...row.order, clientName: row.clientName, storeName: row.clientName, override: row.override, shipmentAccount },
        { includeFinancials: scope.canViewFinancials },
      );
    }),
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
      pkgName: packages.name,
      pkgLength: packages.length,
      pkgWidth: packages.width,
      pkgHeight: packages.height,
    })
    .from(inventory)
    .leftJoin(clients, eq(clients.id, inventory.clientId))
    .leftJoin(packages, eq(packages.id, inventory.packageId))
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

  // Sold-30d per SKU is derived from the ledger ('Ship' rows are negative qty,
  // so we negate the sum). One grouped query over just this page's rows.
  const pageIds = rows.map((r) => r.item.id);
  const soldById = new Map<number, number>();
  if (pageIds.length) {
    const soldRows = await db.execute<{ inventory_id: number; sold: number }>(sql`
      select inventory_id, coalesce(-sum(qty), 0)::int as sold
      from inventory_ledger
      where inventory_id in (${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)})
        and lower(type) like 'ship%'
        and created_at >= now() - interval '30 days'
      group by inventory_id
    `);
    for (const r of soldRows) soldById.set(r.inventory_id, Number(r.sold) || 0);
  }

  await recordPortalAudit('portal.inventory.list', scope, { page, pageSize, search });
  return c.json({
    data: rows.map((row) =>
      toPortalInventoryDto({
        ...row.item,
        clientName: row.clientName,
        storeName: row.clientName,
        storeIds: row.storeIds,
        soldLast30Days: soldById.get(row.item.id) ?? 0,
        pkg: row.pkgName != null || row.pkgLength != null ? { name: row.pkgName, length: row.pkgLength, width: row.pkgWidth, height: row.pkgHeight } : null,
      }),
    ),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

// Inventory movement history (audit trail) — ledger rows scoped to the
// caller's clients. Read-only. Filters: clientId, sku, type, date range.
app.get('/inventory-history', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const sku = c.req.query('sku')?.trim();
  const type = c.req.query('type')?.trim();
  const from = parseDate(c.req.query('from'));
  const to = parseDate(c.req.query('to'));
  const where = and(
    inventoryScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) }),
    sku ? ilike(inventory.sku, `%${sku}%`) : undefined,
    type ? eq(inventoryLedger.type, type) : undefined,
    from ? gte(inventoryLedger.createdAt, from) : undefined,
    to ? lte(inventoryLedger.createdAt, to) : undefined,
  );
  const rows = await db
    .select({
      id: inventoryLedger.id,
      sku: inventory.sku,
      name: inventory.name,
      clientName: clients.name,
      type: inventoryLedger.type,
      qty: inventoryLedger.qty,
      orderId: inventoryLedger.orderId,
      note: inventoryLedger.note,
      source: inventoryLedger.createdBy,
      createdAt: inventoryLedger.createdAt,
    })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .leftJoin(clients, eq(clients.id, inventory.clientId))
    .where(where)
    .orderBy(desc(inventoryLedger.createdAt), desc(inventoryLedger.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.inventory.history', scope, { page, pageSize, sku: sku ?? null, type: type ?? null });
  return c.json({
    data: rows.map((r) => ({ ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt })),
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

// Generate / regenerate billing line items for a date range (admin-only).
// Idempotent (upsert) — safe to re-run. Scope-restricted for non-global users
// so a tenant can only (re)generate their own billing.
app.post('/billing/generate', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { dateFrom?: string; dateTo?: string; clientId?: number };
  if (!body.dateFrom || !body.dateTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  const clientId = typeof body.clientId === 'number' ? body.clientId : undefined;
  if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
    return c.json({ error: 'Requested client is outside your access scope.' }, 403);
  }

  const result = await generateLineItems({
    clientId,
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
    scopeClientIds: scope.isGlobal ? undefined : scope.clientIds,
    scopeStoreIds: scope.isGlobal ? undefined : scope.storeIds,
    scopeRestricted: !scope.isGlobal,
  });

  // Persist a "last generated" marker so the portal can show when billing was
  // last refreshed.
  const generatedAt = new Date().toISOString();
  try {
    const value = JSON.stringify({
      at: generatedAt,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      generated: result.generated,
      total: result.total,
      by: scope.email ?? scope.userId ?? null,
    });
    await db.insert(settings).values({ key: BILLING_LAST_GENERATED_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  } catch (err) {
    console.warn('[client-portal] failed to persist billing last-generated:', err instanceof Error ? err.message : err);
  }

  await recordPortalAudit('portal.billing.generate', scope, { dateFrom: body.dateFrom, dateTo: body.dateTo, clientId, generated: result.generated });
  return c.json({ generated: result.generated, total: result.total, skipped: result.skipped, message: result.message, lastGeneratedAt: generatedAt });
});

const BILLING_LAST_GENERATED_KEY = 'billing_last_generated';

// ── Carrier rate markups (Settings → Markups) ───────────────────────────────
// Per-carrier-account % or flat markup applied to live rate quotes (the profit
// layer). Stored as settings['markup.<carrierId>'] = {type:'pct'|'flat',value}.
// Admin-only. rates.ts reads markup.% at quote time.
function requireBillingAdmin(c: Context) {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return scope;
}

app.get('/markups', async (c) => {
  const scope = requireBillingAdmin(c);
  if (!isClientPortalScope(scope)) return scope;
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings).where(ilike(settings.key, 'markup.%'));
  const markups: Record<string, { type: 'pct' | 'flat'; value: number }> = {};
  for (const r of rows) {
    const id = r.key.slice('markup.'.length);
    if (!id || !r.value) continue;
    try {
      const v = JSON.parse(r.value) as { type?: string; value?: unknown };
      markups[id] = { type: v.type === 'flat' ? 'flat' : 'pct', value: Number(v.value) || 0 };
    } catch {
      /* skip malformed */
    }
  }
  const groups = await listMarkupCarrierGroups();
  await recordPortalAudit('portal.markups.list', scope, { count: Object.keys(markups).length, groups: groups.length });
  return c.json({ groups, markups });
});

app.put('/markups', async (c) => {
  const scope = requireBillingAdmin(c);
  if (!isClientPortalScope(scope)) return scope;
  const body = (await c.req.json().catch(() => ({}))) as { carrierId?: number | string; type?: string; value?: number | null };
  const id = body.carrierId == null ? '' : String(body.carrierId).trim();
  if (!id) return c.json({ error: 'carrierId is required' }, 400);
  const key = `markup.${id}`;

  if (body.value === null) {
    await db.delete(settings).where(eq(settings.key, key));
    await recordPortalAudit('portal.markups.delete', scope, { carrierId: id });
    return c.json({ ok: true, removed: true });
  }

  const type = body.type === 'flat' ? 'flat' : 'pct';
  const value = Math.max(0, Number(body.value) || 0);
  const val = JSON.stringify({ type, value });
  await db.insert(settings).values({ key, value: val }).onConflictDoUpdate({ target: settings.key, set: { value: val } });
  await recordPortalAudit('portal.markups.set', scope, { carrierId: id, type, value });
  return c.json({ ok: true, markup: { type, value } });
});

// When billing was last (re)generated via the portal.
app.get('/billing/status', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.json({ lastGenerated: null });
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, BILLING_LAST_GENERATED_KEY)).limit(1);
  let lastGenerated: unknown = null;
  try {
    lastGenerated = row?.value ? JSON.parse(row.value) : null;
  } catch {
    lastGenerated = null;
  }
  return c.json({ lastGenerated });
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

app.get('/access-list', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('users:manage')) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    console.warn('[client-portal/access-list] listUsers failed:', error.message);
    return c.json({ error: 'Failed to load access list' }, 500);
  }

  const clientRows = await db
    .select({ id: clients.id, name: clients.name, email: clients.email, active: clients.active, storeIds: clients.storeIds })
    .from(clients)
    .orderBy(clients.name)
    .limit(500);
  const clientsById = new Map(clientRows.map((client) => [client.id, client]));

  const users = (data.users ?? [])
    .map((user) => {
      const metadata =
        user.app_metadata && typeof user.app_metadata === 'object' && !Array.isArray(user.app_metadata)
          ? (user.app_metadata as Record<string, unknown>)
          : {};
      const clientIds = normalizeMetadataIds(
        metadata.clientIds ?? metadata.client_ids ?? metadata.assignedClientIds ?? metadata.assigned_client_ids,
      );
      const storeIds = normalizeMetadataIds(
        metadata.storeIds ?? metadata.store_ids ?? metadata.assignedStoreIds ?? metadata.assigned_store_ids,
      );
      const role = typeof metadata.role === 'string' ? metadata.role : null;
      const permissions = stringArray(metadata.permissions);
      const matchedClients = clientIds
        .map((id) => clientsById.get(id))
        .filter((client): client is (typeof clientRows)[number] => Boolean(client));
      const matchedStoreClients = storeIds.length
        ? clientRows.filter((client) => (client.storeIds ?? []).some((storeId) => storeIds.includes(Number(storeId))))
        : [];
      const mergedClients = [...matchedClients];
      for (const client of matchedStoreClients) {
        if (!mergedClients.some((existing) => existing.id === client.id)) mergedClients.push(client);
      }

      return {
        id: user.id,
        email: user.email ?? '',
        role,
        permissions,
        isAdmin: isAdminEmail(user.email) || role === 'admin' || permissions.includes('scope:global'),
        isGlobal: isAdminEmail(user.email) || role === 'admin' || permissions.includes('scope:global'),
        clientIds,
        storeIds,
        clients: mergedClients.map((client) => ({
          id: client.id,
          name: client.name,
          email: client.email,
          active: client.active,
          storeIds: client.storeIds,
        })),
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
      };
    })
    .filter((user) => user.email)
    .sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return a.email.localeCompare(b.email);
    });

  await recordPortalAudit('portal.access_list.view', scope, { users: users.length });
  return c.json({ data: users });
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

// Scope-safe projection of a backfill job. failureSamples embed order numbers
// + ship-to city/state (cross-tenant PII), so they are dropped for any caller
// that is not global. Everything else is non-identifying numeric progress.
function publicBackfillJob(job: BackfillJob | null, isGlobal: boolean) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    updated: job.updated,
    skipped: job.skipped,
    failed: job.failed,
    message: job.message,
    error: job.error,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    ...(isGlobal ? { failureSamples: [...job.failureSamples] } : {}),
  };
}

/**
 * Best-rate backfill — fills the "pending" Best Rate cells in the Orders table.
 *
 * Safety profile (intentionally narrow): fetches ShipStation rate *quotes* via
 * /v2/rates/estimate for awaiting-shipment orders that lack a best rate, then
 * upserts the cheapest into orderOverrides.bestRateJson. It does NOT buy
 * postage/labels, notify marketplaces, or write to the orders table or
 * shipped/cancelled history — so it stays inside the production guardrails.
 *
 * Multi-tenant: a non-global caller is hard-restricted to their own clientIds;
 * a store-only scope (no resolvable clientIds) is refused rather than allowed
 * to fan out across tenants.
 */
app.post('/backfill', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    clientId?: number;
    limit?: number;
    maxAgeHours?: number;
  };

  const jobOpts: { clientId?: number; clientIds?: number[]; limit?: number; maxAgeHours?: number } = {};
  if (scope.isGlobal) {
    // Global admin: optional single-client narrow, otherwise all awaiting orders.
    if (typeof body.clientId === 'number') jobOpts.clientId = body.clientId;
  } else {
    if (!scope.clientIds.length) {
      return c.json({ error: 'Rate backfill requires client-scoped access.' }, 403);
    }
    if (typeof body.clientId === 'number') {
      if (!scope.clientIds.includes(body.clientId)) {
        return c.json({ error: 'Requested client is outside your access scope.' }, 403);
      }
      jobOpts.clientIds = [body.clientId];
    } else {
      jobOpts.clientIds = scope.clientIds;
    }
  }
  if (typeof body.limit === 'number') jobOpts.limit = body.limit;
  if (typeof body.maxAgeHours === 'number') jobOpts.maxAgeHours = body.maxAgeHours;

  const job = startBackfillBestRates(jobOpts);
  void recordPortalAudit('orders.backfill_best_rates.start', scope, {
    jobId: job.jobId,
    scope: scope.isGlobal ? 'global' : 'client',
    clientIds: jobOpts.clientIds ?? (jobOpts.clientId !== undefined ? [jobOpts.clientId] : 'all'),
    limit: jobOpts.limit ?? null,
    maxAgeHours: jobOpts.maxAgeHours ?? null,
  });
  return c.json({ jobId: job.jobId, status: job.status, job: publicBackfillJob(job, scope.isGlobal) });
});

// Poll progress of the active (or most recent) backfill job.
app.get('/backfill/status', (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const job = getActiveBackfillJob() ?? getLatestBackfillJob();
  return c.json({ job: publicBackfillJob(job, scope.isGlobal) });
});

// ── Inbound (receiving) shipments ──────────────────────────────────────────
// Manually-entered POs/ASNs arriving at the warehouse. Read is client-scoped;
// create is admin-only (global or settings:write).
app.get('/inbound', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const clientId = parsePositiveInt(c.req.query('clientId'));

  const preds: (SQL | undefined)[] = [];
  if (!scope.isGlobal) {
    if (!scope.clientIds.length) return c.json({ data: [] });
    preds.push(inArray(inboundShipments.clientId, scope.clientIds));
  }
  if (clientId != null) {
    if (!scope.isGlobal && !scope.clientIds.includes(clientId)) return c.json({ data: [] });
    preds.push(eq(inboundShipments.clientId, clientId));
  }
  const where = preds.length ? and(...preds) : undefined;

  const heads = await db
    .select({
      shipment: inboundShipments,
      clientName: clients.name,
    })
    .from(inboundShipments)
    .leftJoin(clients, eq(clients.id, inboundShipments.clientId))
    .where(where)
    .orderBy(desc(inboundShipments.createdAt), desc(inboundShipments.id))
    .limit(200);

  const ids = heads.map((h) => h.shipment.id);
  const items = ids.length
    ? await db.select().from(inboundItems).where(inArray(inboundItems.inboundId, ids))
    : [];
  const byInbound = new Map<number, typeof items>();
  for (const it of items) {
    const list = byInbound.get(it.inboundId) ?? [];
    list.push(it);
    byInbound.set(it.inboundId, list);
  }

  await recordPortalAudit('portal.inbound.list', scope, { rows: heads.length });
  return c.json({
    data: heads.map((h) => toPortalInboundDto({ ...h.shipment, clientName: h.clientName }, byInbound.get(h.shipment.id) ?? [])),
  });
});

app.post('/inbound', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    clientId?: number;
    reference?: string;
    supplier?: string;
    status?: string;
    carrier?: string;
    trackingNumber?: string;
    expectedDate?: string;
    notes?: string;
    items?: Array<{ sku?: string; name?: string; expectedQty?: number; receivedQty?: number }>;
  };

  const clientId = typeof body.clientId === 'number' ? body.clientId : null;
  if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
    return c.json({ error: 'Requested client is outside your access scope.' }, 403);
  }
  const status = ['expected', 'in_transit', 'received', 'cancelled'].includes(body.status ?? '')
    ? (body.status as string)
    : 'expected';

  const [head] = await db
    .insert(inboundShipments)
    .values({
      clientId,
      reference: body.reference?.trim() || null,
      supplier: body.supplier?.trim() || null,
      status,
      carrier: body.carrier?.trim() || null,
      trackingNumber: body.trackingNumber?.trim() || null,
      expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
      receivedDate: status === 'received' ? new Date() : null,
      notes: body.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .returning();

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const cleanItems = rawItems
    .filter((it) => (it?.sku ?? '').trim() || (it?.name ?? '').trim())
    .slice(0, 200)
    .map((it) => ({
      inboundId: head!.id,
      sku: it.sku?.trim() || null,
      name: it.name?.trim() || null,
      expectedQty: Number(it.expectedQty) || 0,
      receivedQty: Number(it.receivedQty) || 0,
    }));
  if (cleanItems.length) await db.insert(inboundItems).values(cleanItems);

  await recordPortalAudit('portal.inbound.create', scope, { id: head!.id, clientId, items: cleanItems.length });
  return c.json({ data: { id: head!.id } }, 201);
});

// Receive an inbound shipment: set received quantities, mark received, and
// (optionally) add the received units to inventory via the canonical
// applyMovement('receive') ledger writer. Admin-only.
app.patch('/inbound/:id{[0-9]+}/receive', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    addToInventory?: boolean;
    items?: Array<{ id: number; receivedQty: number }>;
  };

  const [head] = await db.select().from(inboundShipments).where(eq(inboundShipments.id, id)).limit(1);
  if (!head) return c.json({ error: 'Inbound shipment not found' }, 404);
  if (!scope.isGlobal && (head.clientId == null || !scope.clientIds.includes(head.clientId))) {
    return c.json({ error: 'Inbound shipment is outside your access scope.' }, 403);
  }

  const items = await db.select().from(inboundItems).where(eq(inboundItems.inboundId, id));
  const recvById = new Map((body.items ?? []).map((i) => [Number(i.id), Math.max(0, Number(i.receivedQty) || 0)]));
  const receivedFor = (it: (typeof items)[number]) => (recvById.has(it.id) ? recvById.get(it.id)! : it.expectedQty);

  for (const it of items) {
    await db.update(inboundItems).set({ receivedQty: receivedFor(it) }).where(eq(inboundItems.id, it.id));
  }
  await db
    .update(inboundShipments)
    .set({ status: 'received', receivedDate: new Date(), updatedAt: new Date() })
    .where(eq(inboundShipments.id, id));

  // Optional inventory bump — match each received line to inventory by SKU
  // within the same client; skip (don't fail) when there's no match.
  const bumps: Array<{ sku: string; qty: number; matched: boolean }> = [];
  if (body.addToInventory) {
    for (const it of items) {
      const qty = receivedFor(it);
      if (!it.sku || qty <= 0) continue;
      const [inv] = await db
        .select({ id: inventory.id })
        .from(inventory)
        .where(
          and(
            sql`lower(${inventory.sku}) = lower(${it.sku})`,
            head.clientId != null ? eq(inventory.clientId, head.clientId) : undefined,
          ),
        )
        .limit(1);
      if (!inv) {
        bumps.push({ sku: it.sku, qty, matched: false });
        continue;
      }
      await applyMovement({
        inventoryId: inv.id,
        type: 'receive',
        qty,
        note: `Inbound ${head.reference ?? `#${head.id}`}`,
        createdBy: scope.email ?? scope.userId,
      });
      bumps.push({ sku: it.sku, qty, matched: true });
    }
  }

  await recordPortalAudit('portal.inbound.receive', scope, { id, addToInventory: !!body.addToInventory, bumps: bumps.length });
  return c.json({ data: { id, status: 'received', bumps } });
});

// Bulk import inbound shipments (CSV/feed). Each shipment is created with its
// line items. Out-of-scope client rows are skipped, not rejected. Admin-only.
app.post('/inbound/import', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    shipments?: Array<{
      clientId?: number;
      reference?: string;
      supplier?: string;
      status?: string;
      carrier?: string;
      trackingNumber?: string;
      expectedDate?: string;
      notes?: string;
      items?: Array<{ sku?: string; name?: string; expectedQty?: number }>;
    }>;
  };
  const shipments = Array.isArray(body.shipments) ? body.shipments.slice(0, 500) : [];
  if (!shipments.length) return c.json({ error: 'No rows to import' }, 400);

  let created = 0;
  let itemsCreated = 0;
  let skipped = 0;
  for (const s of shipments) {
    const clientId = typeof s.clientId === 'number' ? s.clientId : null;
    if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
      skipped++;
      continue;
    }
    const status = ['expected', 'in_transit', 'received', 'cancelled'].includes(s.status ?? '')
      ? (s.status as string)
      : 'expected';
    const [head] = await db
      .insert(inboundShipments)
      .values({
        clientId,
        reference: s.reference?.trim() || null,
        supplier: s.supplier?.trim() || null,
        status,
        carrier: s.carrier?.trim() || null,
        trackingNumber: s.trackingNumber?.trim() || null,
        expectedDate: s.expectedDate ? new Date(s.expectedDate) : null,
        notes: s.notes?.trim() || null,
        updatedAt: new Date(),
      })
      .returning();
    created++;
    const its = (Array.isArray(s.items) ? s.items : [])
      .filter((it) => (it?.sku ?? '').trim() || (it?.name ?? '').trim())
      .slice(0, 200)
      .map((it) => ({
        inboundId: head!.id,
        sku: it.sku?.trim() || null,
        name: it.name?.trim() || null,
        expectedQty: Number(it.expectedQty) || 0,
        receivedQty: 0,
      }));
    if (its.length) {
      await db.insert(inboundItems).values(its);
      itemsCreated += its.length;
    }
  }

  await recordPortalAudit('portal.inbound.import', scope, { created, itemsCreated, skipped });
  return c.json({ data: { created, itemsCreated, skipped } }, 201);
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

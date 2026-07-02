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
import { generateLineItems } from '../services/billing';
import { billingSummary } from '../services/billing-summaries';
import { getSkuOrdersForSku } from '../services/sku-orders';
import { getSkuBreakdownFromOrderItems } from './analysis';
import {
  HERITAGE_PREP_FEE_CLIENT_NAME,
  heritagePrepFeeRowsForRange,
} from '../lib/heritage-prep-fee-overrides';
import { getSyncStatus } from '../services/order-sync';
import { getShipmentSyncStatus } from '../services/shipment-sync';
import { refreshShipmentTracking } from '../services/shipment-tracking';
import { getPersistedWorkerStatus } from '../services/worker-status';
import {
  startBackfillBestRates,
  getActiveBackfillJob,
  getLatestBackfillJob,
  type BackfillJob,
} from '../services/rates-backfill';
import { getProviderAccountNicknames, listMarkupCarrierGroups } from '../services/rates';
import { isAdminEmail } from '../lib/admin-emails';
import {
  CREDENTIAL_PROVIDER_PATTERN,
  maskAccountIdentifier,
  normalizeCredentialAccountBody,
} from '../lib/credential-accounts';
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
  safeItemQty,
  topSkuRows,
  dailyRevenueRows,
  dailyOrderUnitsRows,
} from '../lib/client-portal/dashboard-aggregate';
import { invoiceItemNameLinesSql } from '../lib/client-portal/invoice-items';
import {
  assertClientPortalScope,
  isClientPortalScope,
  type ClientPortalScope,
} from '../lib/client-portal/scope';
import {
  activeClientPredicate,
  clientFilterPredicate,
  clientScopePredicate,
  intArrayLiteral,
  inventoryScopePredicate,
  inventorySearchPredicate,
  orderScopePredicate,
  orderSearchPredicate,
  rawOrderScopeForAlias,
  shipmentScopePredicate,
  shipmentSearchPredicate,
  visibleAwaitingOrdersPredicate,
} from '../lib/client-portal/predicates';
import {
  portalInvoiceDetailCount,
  portalInvoiceDetails,
  portalInvoicePeriodSummary,
  portalInvoiceSummary,
} from '../lib/client-portal/read-models/invoice-details';
import {
  awaitingActiveOrderCount,
  getPortalOrder,
  listPortalOrders,
} from '../lib/client-portal/read-models/orders';
import { listPortalShipments, SHIPMENT_STATUS_FILTERS } from '../lib/client-portal/read-models/shipments';
import { listPortalInventory } from '../lib/client-portal/read-models/inventory';
import { listPortalIntegrations } from '../lib/client-portal/read-models/integrations';
import {
  accessAppMeta,
  countActiveAdmins,
  DEACTIVATE_BAN_DURATION,
  listPortalAccessRoster,
  normalizeMetadataIds,
  stringArray,
  userIsAdminLike,
} from '../lib/client-portal/read-models/access';
import { renderPortalInvoiceHtml } from '../lib/client-portal/invoice-html';

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

function scopeOrResponse(c: Context) {
  const scope = assertClientPortalScope(c);
  return isClientPortalScope(scope) ? scope : scope;
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
    // Order + unit counts per day power the cumulative bar chart. Counts are
    // non-financial, so they are returned regardless of canViewFinancials.
    daily: dailyOrderUnitsRows(rows),
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
  const result = await listPortalOrders(scope, { page, pageSize, status, clientId, storeId, search });
  await recordPortalAudit('portal.orders.list', scope, { status: status ?? 'all', page, pageSize, clientId, search });
  return c.json(result);
});

app.get('/orders/awaiting-active-count', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const count = await awaitingActiveOrderCount(scope, {
    clientId: requestedClientId(c),
    storeId: requestedStoreId(c),
  });
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
  const data = await getPortalOrder(scope, id);
  if (!data) return c.json({ error: 'Order not found' }, 404);
  await recordPortalAudit('portal.orders.detail.view', scope, { orderId: id });
  return c.json({ data });
});

// CP-008: shipment information for one order — powers the Billing line-item
// Order # modal. Scope-checked; DTO redaction (no label URLs / provider
// payloads / account identities) and financial gating come from
// toPortalShipmentDto like every other shipment surface.
app.get('/orders/:id{[0-9]+}/shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const orderId = Number(c.req.param('id'));
  const rows = await db
    .select({
      shipment: shipments,
      clientName: clients.name,
      storeId: orders.storeId,
      orderItems: orders.items,
      // Billed shipping only (matches the Billing surfaces) — never the
      // internal label cost.
      shippingCost: sql<string | null>`(
        select sum(bli.total_cost)
        from billing_line_items bli
        where bli.shipment_id = ${shipments.id}
          and bli.line_type = 'shipping'
      )::text`,
    })
    .from(shipments)
    .leftJoin(clients, eq(clients.id, shipments.clientId))
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(eq(shipments.orderId, orderId), eq(shipments.voided, false), shipmentScopePredicate(scope)))
    .orderBy(desc(shipments.id))
    .limit(20);
  await recordPortalAudit('portal.billing.order_shipments.view', scope, { orderId, rows: rows.length });
  return c.json({
    data: rows.map((row) =>
      toPortalShipmentDto(
        {
          ...row.shipment,
          clientName: row.clientName,
          storeName: row.clientName,
          storeId: row.storeId,
          orderItems: row.orderItems,
          shippingCost: row.shippingCost,
        },
        { includeFinancials: scope.canViewFinancials },
      ),
    ),
  });
});

app.get('/shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const statusParam = c.req.query('status');
  const status = statusParam && SHIPMENT_STATUS_FILTERS.has(statusParam) ? statusParam : undefined;
  const result = await listPortalShipments(scope, {
    page,
    pageSize,
    clientId: requestedClientId(c),
    storeId: requestedStoreId(c),
    search,
    status,
  });
  await recordPortalAudit('portal.shipments.list', scope, { page, pageSize, search, status: status ?? null });
  return c.json(result);
});

// Live tracking refresh for shipments on screen. Read-only against the
// carrier (ShipStation /v2/tracking) — looks up delivery state and persists
// the snapshot. Scope-checked: callers can only refresh shipments they can
// already see; the service itself re-polls each shipment at most once per
// half hour and treats delivered as terminal.
app.post('/shipments/refresh-tracking', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const body = (await c.req.json().catch(() => null)) as { shipmentIds?: unknown } | null;
  const requested = Array.isArray(body?.shipmentIds)
    ? body.shipmentIds.map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 100)
    : [];
  if (!requested.length) return c.json({ checked: 0, updated: [] });
  const visible = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(inArray(shipments.id, requested), shipmentScopePredicate(scope)));
  const result = await refreshShipmentTracking(visible.map((row) => row.id));
  await recordPortalAudit('portal.shipments.refresh_tracking', scope, {
    requested: requested.length,
    checked: result.checked,
    updated: result.updated.length,
  });
  return c.json(result);
});

app.get('/inventory', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const lowStock = ['1', 'true', 'yes'].includes((c.req.query('lowStock') ?? '').toLowerCase());
  const result = await listPortalInventory(scope, {
    page,
    pageSize,
    clientId: requestedClientId(c),
    storeId: requestedStoreId(c),
    search,
    lowStock,
  });
  await recordPortalAudit('portal.inventory.list', scope, { page, pageSize, search, lowStock });
  return c.json(result);
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

// When billing was last (re)generated — read from billing_line_items itself,
// so the timestamp is truthful regardless of which app generated (the admin
// system owns generation; it does not write this repo's settings marker).
app.get('/billing/status', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.json({ lastGenerated: null });
  let lastGenerated: unknown = null;
  try {
    const rows = await db.execute<{ at: string | null }>(
      sql`select to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from billing_line_items`,
    );
    const at = rows[0]?.at ?? null;
    lastGenerated = at ? { at } : null;
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

  // Paged mode (portal drill-in): page + pageSize present → return a slice
  // plus pagination totals, so the table never renders thousands of rows.
  if (c.req.query('page')) {
    const page = parsePage(c.req.query('page'));
    const pageSize = parsePageSize(c.req.query('pageSize'));
    const [rows, total] = await Promise.all([
      portalInvoiceDetails(scope, { clientId, dateFrom, dateTo, page, pageSize }),
      portalInvoiceDetailCount(scope, { clientId, dateFrom, dateTo }),
    ]);
    await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: rows.length, page });
    return c.json({
      data: rows,
      billingVisible: true,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  }

  const rows = await portalInvoiceDetails(scope, { clientId, dateFrom, dateTo });
  await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: rows.length });
  return c.json({ data: rows, billingVisible: true });
});

// Per-client billing rollup, aggregated in SQL with no row cap — the Billing
// summary's source of truth (the row-capped /invoice-details is for the
// per-client drill-in and exports).
app.get('/invoice-summary', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.invoice_summary.denied', scope);
    return c.json({ data: [], billingVisible: false }, 403);
  }
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if (!dateFrom || !dateTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  const clientId = requestedClientId(c);
  // groupBy=period → one row per client per billing period; granularity
  // 'half' (default, 1st–15th / 16th–EOM) or 'month' (combined 1st–EOM).
  // Without groupBy the plain per-client rollup is returned.
  const rows =
    c.req.query('groupBy') === 'period'
      ? await portalInvoicePeriodSummary(scope, {
          clientId,
          dateFrom,
          dateTo,
          granularity: c.req.query('granularity') === 'month' ? 'month' : 'half',
        })
      : await portalInvoiceSummary(scope, { clientId, dateFrom, dateTo });
  await recordPortalAudit('portal.invoice_summary.view', scope, { clientId, rows: rows.length });
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
    orderCount: Number(row?.orderCount ?? 0),
    qty: 0,
    pickPackTotal: Number(row?.pickPackTotal ?? 0),
    additionalTotal: Number(row?.additionalTotal ?? 0),
    packageTotal: Number(row?.packageTotal ?? 0),
    shippingTotal: Number(row?.shippingTotal ?? 0),
    storageTotal: Number(row?.storageTotal ?? 0),
    grandTotal: Number(row?.grandTotal ?? 0),
  };
  return c.html(renderPortalInvoiceHtml({ clientName: client.name, dateFrom, dateTo, invoiceTotals, details }));
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
  const roster = await listPortalAccessRoster();
  if ('error' in roster) return c.json({ error: roster.error }, 500);
  await recordPortalAudit('portal.access_list.view', scope, { users: roster.users.length });
  return c.json({ data: roster.users });
});

/* ---- Access roster admin mutations (deactivate/activate, edit, delete) ----
   All gated behind the same global/'users:manage' check as the GET above and
   guarded against lock-out: nobody can deactivate/delete their own login, a
   protected operator (hardcoded admin email), or the last remaining admin. */

function requireUserManageAdmin(c: Context, scope: ClientPortalScope) {
  if (!scope.isGlobal && !scope.permissions.includes('users:manage')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return null;
}

// PATCH = edit role / assigned client stores / display name, and/or toggle active.
app.patch('/access-list/:id', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const denied = requireUserManageAdmin(c, scope);
  if (denied) return denied;

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    role?: string | null;
    clientIds?: unknown;
    displayName?: string | null;
    active?: boolean;
  };

  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);
  const user = target.user;

  const isSelf = user.id === scope.userId;
  const deactivating = body.active === false;
  const demotingAdmin = typeof body.role === 'string' && body.role !== 'admin' && userIsAdminLike(user);

  // Lock-out guardrails.
  if (deactivating && isSelf) return c.json({ error: "You can't deactivate your own login." }, 400);
  if (deactivating && isAdminEmail(user.email)) {
    return c.json({ error: 'This is a protected operator account and cannot be deactivated.' }, 400);
  }
  if ((deactivating || demotingAdmin) && userIsAdminLike(user)) {
    if ((await countActiveAdmins()) <= 1) {
      return c.json({ error: 'At least one active admin must remain.' }, 400);
    }
  }

  // Merge metadata so we never clobber unrelated keys.
  const meta = { ...accessAppMeta(user) };
  if (body.role !== undefined) {
    if (body.role === 'admin') {
      meta.role = 'admin';
    } else {
      meta.role = body.role || 'client_user';
      // Strip the global grant so a demoted user isn't still effectively admin.
      meta.permissions = stringArray(meta.permissions).filter((p) => p !== 'scope:global');
    }
  }
  if (body.clientIds !== undefined) meta.clientIds = normalizeMetadataIds(body.clientIds);

  const updates: Record<string, unknown> = { app_metadata: meta };
  if (body.displayName !== undefined) {
    const userMeta =
      user.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
        ? (user.user_metadata as Record<string, unknown>)
        : {};
    updates.user_metadata = { ...userMeta, name: body.displayName, display_name: body.displayName };
  }
  if (body.active !== undefined) updates.ban_duration = body.active ? 'none' : DEACTIVATE_BAN_DURATION;

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(id, updates);
  if (updErr) {
    console.warn('[client-portal/access-list] update failed:', updErr.message);
    return c.json({ error: 'Failed to update user' }, 500);
  }
  await recordPortalAudit('portal.access_list.update', scope, {
    targetId: id,
    role: body.role ?? undefined,
    active: body.active ?? undefined,
    clientIds: body.clientIds !== undefined ? normalizeMetadataIds(body.clientIds) : undefined,
    renamed: body.displayName !== undefined ? true : undefined,
  });
  return c.json({ ok: true });
});

// DELETE = permanently remove the Supabase Auth login.
app.delete('/access-list/:id', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const denied = requireUserManageAdmin(c, scope);
  if (denied) return denied;

  const id = c.req.param('id');
  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);
  const user = target.user;

  if (user.id === scope.userId) return c.json({ error: "You can't delete your own login." }, 400);
  if (isAdminEmail(user.email)) {
    return c.json({ error: 'This is a protected operator account and cannot be deleted.' }, 400);
  }
  if (userIsAdminLike(user) && (await countActiveAdmins()) <= 1) {
    return c.json({ error: 'At least one active admin must remain.' }, 400);
  }

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (delErr) {
    console.warn('[client-portal/access-list] delete failed:', delErr.message);
    return c.json({ error: 'Failed to delete user' }, 500);
  }
  await recordPortalAudit('portal.access_list.delete', scope, { targetId: id, email: user.email ?? null });
  return c.json({ ok: true });
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
  const { data, carrierCount, storeCount } = await listPortalIntegrations(scope);
  await recordPortalAudit('portal.integrations.list', scope, { carriers: carrierCount, stores: storeCount });
  return c.json({ data });
});

// Submit a store connection from the portal (M7). Admin-only. The account is
// created with source='portal' AND active=false, so no sync/worker path can use
// the submitted credentials until an operator vets and promotes it
// ('portal' → 'admin') in the internal app. Credentials are stored via the same
// store_accounts rails as the internal API (RLS-protected) and are NEVER echoed
// back in the response or audit trail — field names only.
app.post('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!(isAdminEmail(scope.email) || scope.role === 'admin')) {
    return c.json({ error: 'admin required' }, 403);
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const account = normalizeCredentialAccountBody(rawBody, 'portal');
  // Portal submissions can never claim admin provenance, whatever the body says.
  account.source = 'portal';
  if (!CREDENTIAL_PROVIDER_PATTERN.test(account.provider)) {
    return c.json({ error: 'invalid provider' }, 400);
  }
  if (!account.label?.trim()) return c.json({ error: 'store name required' }, 400);
  if (!account.credentialKeys.length) return c.json({ error: 'credentials required' }, 400);
  if (JSON.stringify(account.credentials).length > 20_000) {
    return c.json({ error: 'credentials too large' }, 400);
  }

  try {
    // Plain INSERT (not the shared upsert): ON CONFLICT DO NOTHING so a portal
    // submission can never overwrite the credentials of an existing live
    // account with the same client/provider/identifier — duplicates get a 409.
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
      insert into store_accounts (client_id, provider, label, account_identifier, credentials, source, active)
      values (
        ${account.clientId},
        ${account.provider},
        ${account.label},
        ${account.accountIdentifier},
        ${JSON.stringify(account.credentials)}::jsonb,
        'portal',
        false
      )
      on conflict (coalesce(client_id, -1), provider, coalesce(account_identifier, '')) do nothing
      returning id,
                client_id as "clientId",
                provider,
                label,
                account_identifier as "accountIdentifier",
                source,
                active,
                created_at as "createdAt",
                updated_at as "updatedAt"
    `);
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'A connection for this store already exists.' }, 409);
    }
    await recordPortalAudit('portal.integrations.request', scope, {
      provider: account.provider,
      clientId: account.clientId,
      accountIdentifier: maskAccountIdentifier(account.accountIdentifier),
      credentialFields: account.credentialKeys,
    });
    return c.json({ data: toPortalIntegrationDto({ ...row, type: 'store' }) }, 201);
  } catch (err) {
    console.warn('[client-portal] store connection request failed:', err);
    return c.json({ error: 'store connections are unavailable right now' }, 503);
  }
});

app.get('/activity', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.activity.view', scope);
  return c.json({ data: [] });
});


export default app;

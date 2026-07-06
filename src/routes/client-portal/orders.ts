// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { billingConfig } from '../../db/schema/billing';
import { clients } from '../../db/schema/clients';
import { orderOverrides, orders } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { shipmentCustomerShippingRateSql } from '../../lib/client-portal/customer-shipping-rate';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { shipmentScopePredicate } from '../../lib/client-portal/predicates';
import { toPortalShipmentDto } from '../../lib/client-portal/dto';
import { awaitingActiveOrderCount, getPortalOrder, listPortalOrders } from '../../lib/client-portal/read-models/orders';
import { startBackfillBestRates, getActiveBackfillJob, getLatestBackfillJob, type BackfillJob } from '../../services/rates-backfill';
import { parsePage, parsePageSize, parsePositiveInt, requestedSearch, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

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
      // Frozen billed shipping first; projected backend customer-rate fallback
      // only until Admin Billing freezes the period into billing_line_items.
      shippingCost: shipmentCustomerShippingRateSql(),
    })
    .from(shipments)
    .leftJoin(clients, eq(clients.id, shipments.clientId))
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .leftJoin(billingConfig, eq(billingConfig.clientId, shipments.clientId))
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

export default app;

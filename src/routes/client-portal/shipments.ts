// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { shipments } from '../../db/schema/shipments';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { shipmentScopePredicate } from '../../lib/client-portal/predicates';
import { refreshShipmentTracking } from '../../services/shipment-tracking';
import { listPortalShipments, SHIPMENT_STATUS_FILTERS } from '../../lib/client-portal/read-models/shipments';
import { isPortalShipmentStatus } from '../../lib/client-portal/shipment-status';
import { parsePage, parsePageSize, requestedSearch, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

app.get('/shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const statusParam = c.req.query('status');
  const status = isPortalShipmentStatus(statusParam) && SHIPMENT_STATUS_FILTERS.has(statusParam)
    ? statusParam
    : undefined;
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const result = await listPortalShipments(scope, {
    page,
    pageSize,
    clientId,
    storeId,
    search,
    status,
  });
  await recordPortalAudit('portal.shipments.list', scope, {
    page,
    pageSize,
    clientId,
    storeId,
    search,
    status: status ?? null,
  });
  return c.json(result);
});

// Live tracking refresh for shipments on screen. It checks the official
// carrier first and uses ShipStation label tracking as a fallback. The request
// is scope-checked and deliberately bypasses background refresh cooldowns.
app.post('/shipments/refresh-tracking', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const body = (await c.req.json().catch(() => null)) as { shipmentIds?: unknown } | null;
  const requested = Array.isArray(body?.shipmentIds)
    ? body.shipmentIds.map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 100)
    : [];
  if (!requested.length) return c.json({ checked: 0, failed: 0, updated: [] });
  const visible = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(inArray(shipments.id, requested), shipmentScopePredicate(scope)));
  const result = await refreshShipmentTracking(visible.map((row) => row.id), {
    forceRefresh: true,
    logDiagnostics: true,
  });
  await recordPortalAudit('portal.shipments.refresh_tracking', scope, {
    requested: requested.length,
    checked: result.checked,
    failed: result.failed,
    updated: result.updated.length,
    forceRefresh: true,
  });
  return c.json(result);
});

export default app;

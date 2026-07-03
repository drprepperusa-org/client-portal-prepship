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
import { parsePage, parsePageSize, requestedSearch, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

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

export default app;

// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { z } from 'zod';
import { exportPortalShipments, ShipmentExportTooLarge } from '../../lib/client-portal/read-models/shipment-export';
import { and, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { shipments } from '../../db/schema/shipments';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { shipmentScopePredicate } from '../../lib/client-portal/predicates';
import { refreshShipmentTracking } from '../../services/shipment-tracking';
import { listPortalShipments, SHIPMENT_STATUS_FILTERS } from '../../lib/client-portal/read-models/shipments';
import { resolveShipmentStatusFilterParam } from '../../lib/client-portal/shipment-status';
import { parsePage, parsePageSize, requestedSearch, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();
const shipmentRangeQuery = z.object({
  format: z.literal('csv').optional(),
  clientId: z.coerce.number().int().positive().optional(),
  storeId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
}).refine(value => !value.dateFrom || !value.dateTo || Date.parse(value.dateFrom) <= Date.parse(value.dateTo));

app.get('/shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  c.header('Cache-Control', 'private, no-store');
  const range = shipmentRangeQuery.safeParse(c.req.query());
  if (!range.success) return c.json({ error: 'Invalid shipment date range or export format.' }, 400);
  const { format, dateFrom, dateTo } = range.data;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  // CP-069: contract values pass; the pre-CP-069 carrier vocabulary aliases to 'shipped' for one
  // release (LEGACY_SHIPMENT_STATUS_FILTER_ALIASES); anything else means no filter.
  const resolvedStatus = resolveShipmentStatusFilterParam(c.req.query('status'));
  const status = resolvedStatus && SHIPMENT_STATUS_FILTERS.has(resolvedStatus) ? resolvedStatus : undefined;
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  if (format === 'csv') {
    const requestedStatus = c.req.query('status');
    if (requestedStatus && requestedStatus !== 'all' && !status) return c.json({ error: 'Invalid shipment status.' }, 400);
    try {
      const result = await exportPortalShipments(scope, {
        clientId, storeId, search, status, dateFrom, dateTo,
        sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir'),
      });
      await recordPortalAudit('portal.shipments.export', scope, { clientId, storeId, search, status: status ?? null,
        dateFrom, dateTo, rows: result.rows, sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir') });
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', 'attachment; filename="shipments.csv"');
      return c.body(result.csv);
    } catch (error) {
      if (error instanceof ShipmentExportTooLarge) return c.json({ error: 'Export is too large. Narrow your filters and try again.' }, 413);
      return c.json({ error: 'Could not export shipments. Please try again.' }, 503);
    }
  }
  const result = await listPortalShipments(scope, {
    dateFrom, dateTo,
    sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir'),
    page,
    pageSize,
    clientId,
    storeId,
    search,
    status,
  });
  await recordPortalAudit('portal.shipments.list', scope, {
    dateFrom, dateTo,
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

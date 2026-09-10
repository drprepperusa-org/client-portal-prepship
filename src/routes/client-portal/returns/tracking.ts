// CP-069 — returns-scoped carrier tracking refresh.
//
// Before CP-069 the ONLY browser-driven refresh of shipments.tracking_status was the outbound
// Shipments page, which (incidentally) listed return labels and so kept the CP-033 return
// lifecycle advance (label_created -> in_transit) and the CP-062 arrival signal fresh. The
// outbound surface no longer lists return labels and no longer depends on carrier telemetry,
// and the tracking sweep never runs in the client-portal API process (src/main.ts) — so the
// refresh trigger moves to the surface whose display DOES depend on telemetry: Returns.
//
// Scope-checked: only returns visible to the caller, resolved to their return shipment ids
// server-side (the client never names shipment ids). The refresh service itself is unchanged
// (forced refresh, official carrier first, ShipStation fallback, CP-033 advance). The response
// carries counts only — no carrier telemetry crosses to the client from this route; the Returns
// list re-reads its own CP-062 contract after a change.
import type { Hono } from 'hono';
import { and, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../../../db/client';
import { returns } from '../../../db/schema/returns';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { refreshShipmentTracking } from '../../../services/shipment-tracking';
import { returnScopePredicate } from './shared';

const MAX_RETURNS_PER_REFRESH = 100;

export function registerReturnTrackingRefreshRoute(app: Hono): void {
  app.post('/returns/refresh-tracking', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const body = (await c.req.json().catch(() => null)) as { returnIds?: unknown } | null;
    const requested = Array.isArray(body?.returnIds)
      ? body.returnIds
          .map(Number)
          // Postgres integer ids only: a fractional or oversized value would reach the driver and 500.
          .filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647)
          .slice(0, MAX_RETURNS_PER_REFRESH)
      : [];
    if (!requested.length) return c.json({ checked: 0, failed: 0, updated: 0 });

    const visible = await db
      .select({ id: returns.id, returnShipmentId: returns.returnShipmentId })
      .from(returns)
      .where(and(inArray(returns.id, requested), isNotNull(returns.returnShipmentId), returnScopePredicate(scope)));
    const shipmentIds = visible
      .map((row) => row.returnShipmentId)
      .filter((id): id is number => typeof id === 'number' && id > 0);
    if (!shipmentIds.length) return c.json({ checked: 0, failed: 0, updated: 0 });

    // Page-load trigger, not a manual button: honour the service's own 30-minute per-shipment
    // cooldown (REFRESH_STALE_MS) so a client reloading Returns cannot amplify into repeated
    // carrier / ShipStation lookups for the same labels. A label never checked, or checked more
    // than 30 minutes ago, still refreshes immediately.
    const result = await refreshShipmentTracking(shipmentIds, { forceRefresh: false, logDiagnostics: true });
    await recordPortalAudit('portal.returns.refresh_tracking', scope, {
      requested: requested.length,
      visible: visible.length,
      checked: result.checked,
      failed: result.failed,
      updated: result.updated.length,
      forceRefresh: true,
    });
    return c.json({ checked: result.checked, failed: result.failed, updated: result.updated.length });
  });
}

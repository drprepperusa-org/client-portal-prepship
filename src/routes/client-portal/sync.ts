// Client-portal sub-router — mounted at /api/client-portal/*.
import { Hono } from 'hono';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { listPortalStoreIntegrations } from '../../lib/client-portal/read-models/integrations';
import { scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

/**
 * CP-054: customer sync status is tenant connection freshness only.
 * Global order/shipment worker state, queue diagnostics, and internal errors
 * belong to operations surfaces and never cross this customer endpoint.
 */
app.get('/sync-status', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  try {
    const rows = await listPortalStoreIntegrations(scope);
    const connections = rows.map((row) => ({
      id: row.id,
      connectionStatus: row.connectionStatus,
      lastSyncedAt: row.lastSyncedAt,
    }));
    const lastSyncAt = connections.reduce<string | null>((latest, row) => {
      if (!row.lastSyncedAt) return latest;
      return !latest || row.lastSyncedAt > latest ? row.lastSyncedAt : latest;
    }, null);
    // Backend-owned aggregate for the top bar. Precedence is documented and
    // deterministic: attention > active > pending > inactive > no connection.
    const connectionStatus = connections.some((row) =>
      row.connectionStatus === 'reconnect' || row.connectionStatus === 'degraded')
      ? 'attention'
      : connections.some((row) => row.connectionStatus === 'active')
        ? 'active'
        : connections.some((row) => row.connectionStatus === 'pending')
          ? 'pending'
          : connections.some((row) => row.connectionStatus === 'inactive')
            ? 'inactive'
            : 'not_connected';
    return c.json({ connectionStatus, lastSyncAt, connections });
  } catch (error) {
    console.error('[client-portal] connection freshness unavailable:', error);
    return c.json({ error: 'connection_freshness_unavailable' }, 503);
  }
});

export default app;

import { Hono } from 'hono';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import { listPortalRateSheets } from '../../lib/client-portal/read-models/rate-sheet';
import { isClientPortalScope } from '../../lib/client-portal/scope';

const app = new Hono();
app.get('/rate-sheet', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.json({ error: 'financials:read required' }, 403);
  const rawClientId = c.req.query('clientId');
  if (rawClientId != null && (!/^\d+$/.test(rawClientId)
    || !Number.isSafeInteger(Number(rawClientId)) || Number(rawClientId) < 1)) {
    return c.json({ error: 'invalid_client_id' }, 400);
  }
  const clientId = rawClientId == null ? undefined : Number(rawClientId);
  try {
    const data = await listPortalRateSheets(scope, clientId);
    await recordPortalAudit('portal.rate_sheet.view', scope, { clientId, rows: data.length });
    return c.json({ data });
  } catch (error) {
    console.error('[client-portal] rate sheet unavailable:', error);
    return c.json({ error: 'rate_sheet_unavailable' }, 503);
  }
});
export default app;

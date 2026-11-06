import { Hono, type Context } from 'hono';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import { listPortalRateSheets } from '../../lib/client-portal/read-models/rate-sheet';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { proxyRateSheetCommand } from '../../lib/client-portal/prepship-rate-sheet-proxy';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

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
  const authorization = c.req.header('authorization');
  if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
  try {
    const data = await listPortalRateSheets(scope, clientId, authorization, c.req.header('x-request-id'));
    await recordPortalAudit('portal.rate_sheet.view', scope, { clientId, rows: data.length });
    return c.json({ data });
  } catch (error) {
    console.error('[client-portal] rate sheet unavailable:', error);
    return c.json({ error: 'rate_sheet_unavailable' }, 503);
  }
});
async function relayRateSheet(c: Context, operation: 'access' | 'services' | 'package' | 'add-box') {
    c.header('Cache-Control', 'private, no-store');
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    if (!scope.canViewFinancials) return c.json({ error: 'financials:read required' }, 403);
    const authorization = c.req.header('authorization');
    if (!authorization) return c.json({ error: 'Sign in required.' }, 401);
    const body = operation === 'access' ? undefined : await c.req.json().catch(() => null);
    if (operation !== 'access' && !body) return c.json({ error: 'Invalid request.' }, 400);
    try {
      const result = await proxyRateSheetCommand(operation, authorization, body, c.req.header('x-request-id'));
      return c.json(result.data, result.status as ContentfulStatusCode);
    } catch {
      return c.json({ error: 'Unable to reach the rate sheet service. Refresh before retrying.' }, 503);
    }
}
app.get('/rate-sheet/access', c => relayRateSheet(c, 'access'));
app.post('/rate-sheet/:operation', c => {
  const operation = c.req.param('operation');
  if (operation !== 'services' && operation !== 'package' && operation !== 'add-box') return c.json({ error: 'Not found' }, 404);
  return relayRateSheet(c, operation);
});
export default app;

import { Hono } from 'hono';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { getPortalAttention } from '../../lib/client-portal/read-models/attention';

const app = new Hono();
app.get('/attention', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const raw = c.req.query('clientId');
  if (raw != null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) {
    return c.json({ error: 'invalid_client_id' }, 400);
  }
  try {
    return c.json(await getPortalAttention(scope, raw == null ? undefined : Number(raw)));
  } catch (error) {
    console.error('[client-portal] attention unavailable:', error);
    return c.json({ error: 'attention_unavailable' }, 503);
  }
});
export default app;

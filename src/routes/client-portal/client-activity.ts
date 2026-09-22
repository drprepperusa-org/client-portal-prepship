import { Hono } from 'hono';
import { z } from 'zod';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { readClientActivity } from '../../lib/client-portal/read-models/client-activity';

const app = new Hono();
const filters = z.object({
  search: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  days: z.enum(['7', '30', '90']).default('30').transform(Number),
});
app.get('/audit-log/client-activity', async c => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!clientPortalCapabilities(scope).canViewAudit) return c.json({ error: 'Admin access required' }, 403);
  const parsed = filters.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid client activity filters' }, 400);
  c.header('Cache-Control', 'private, no-store');
  try { return c.json(await readClientActivity(parsed.data)); }
  catch { return c.json({ error: 'Client activity is temporarily unavailable' }, 503); }
});
export default app;

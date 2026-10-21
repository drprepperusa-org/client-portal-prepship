import { Hono } from 'hono';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { BillingColumnsConflict, canManageBillingColumns, parseBillingColumnUpdate, readBillingColumns, saveBillingColumns } from '../../lib/client-portal/billing-columns';

export function createBillingColumnsRoute(deps = { read: readBillingColumns, save: saveBillingColumns }) {
  const app = new Hono();
  app.get('/billing/columns', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    if (!scope.userId || !scope.canViewFinancials) return c.json({ error: 'Billing access required' }, 403);
    try { return c.json({ ...await deps.read(), canManage: canManageBillingColumns(scope) }); }
    catch { return c.json({ error: 'Billing column settings unavailable' }, 503); }
  });
  app.put('/billing/columns', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    if (!canManageBillingColumns(scope)) return c.json({ error: 'Global admin access required' }, 403);
    const update = parseBillingColumnUpdate(await c.req.json().catch(() => null));
    if (!update) return c.json({ error: 'Invalid billing column settings' }, 400);
    try { return c.json({ ...await deps.save(scope, update), canManage: true }); }
    catch (error) {
      if (error instanceof BillingColumnsConflict) return c.json({ error: error.message }, 409);
      return c.json({ error: 'Billing column settings could not be saved' }, 503);
    }
  });
  return app;
}
export default createBillingColumnsRoute();

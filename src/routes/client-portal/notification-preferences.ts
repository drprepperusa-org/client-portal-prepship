import { Hono } from 'hono';
import { scopeOrResponse } from '../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { parseNotificationPreferences, readNotificationPreferences, saveNotificationPreferences } from '../../lib/client-portal/notification-preferences';

const app = new Hono();
app.get('/notification-preferences', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.userId) return c.json({ error: 'authentication_required' }, 401);
  try { return c.json(await readNotificationPreferences(scope.userId)); }
  catch { return c.json({ error: 'notification_preferences_unavailable' }, 503); }
});
app.put('/notification-preferences', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.userId) return c.json({ error: 'authentication_required' }, 401);
  const preferences = parseNotificationPreferences(await c.req.json().catch(() => null));
  if (!preferences) return c.json({ error: 'invalid_notification_preferences' }, 400);
  try {
    const saved = await saveNotificationPreferences(scope.userId, preferences);
    await recordPortalAudit('portal.notification_preferences.update', scope, { ...saved });
    return c.json(saved);
  } catch { return c.json({ error: 'notification_preferences_save_failed' }, 503); }
});
export default app;

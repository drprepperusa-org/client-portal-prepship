import type { Hono } from 'hono';
import { verifyShopifyCredentials } from '../../../connectors/store/shopify';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { checkValidationRateLimit } from '../../../lib/client-portal/integration-submission';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { listPortalIntegrations } from '../../../lib/client-portal/read-models/integrations';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { maskAccountIdentifier } from '../../../lib/credential-accounts';
import {
  readShopifyCredentialInput,
  SHOPIFY_CONNECT_ERROR,
  shopifyConnectError,
} from './shopify';

export function registerIntegrationReadRoutes(app: Hono): void {
  app.get('/integrations', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    try {
      const { data, carrierCount, storeCount } = await listPortalIntegrations(scope);
      await recordPortalAudit('portal.integrations.list', scope, { carriers: carrierCount, stores: storeCount });
      return c.json({ data });
    } catch (error) {
      console.error('[client-portal] connections list unavailable:', error);
      return c.json({ error: 'connections_unavailable' }, 503);
    }
  });

  // Pre-submit feedback only. Submission re-verifies server-side.
  app.post('/integrations/validate', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    if (!checkValidationRateLimit(scope.userId)) {
      return c.json({ error: 'too many validation attempts — wait a minute and retry' }, 429);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const provider = String(body?.provider ?? '').toLowerCase();
    if (provider !== 'shopify') {
      return c.json({ error: 'live validation is only available for shopify' }, 400);
    }
    const credentials =
      body?.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials)
        ? (body.credentials as Record<string, unknown>)
        : {};
    const shopifyInput = readShopifyCredentialInput(credentials);
    if (!shopifyInput) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);

    const result = await verifyShopifyCredentials(shopifyInput);
    await recordPortalAudit('portal.integrations.validate', scope, {
      provider,
      ok: result.ok,
      accountIdentifier: result.ok ? maskAccountIdentifier(result.myshopifyDomain) : null,
    });
    if (!result.ok) return c.json({ error: shopifyConnectError(result) }, 422);
    return c.json({
      data: {
        ok: true,
        displayAccountIdentifier: maskAccountIdentifier(result.myshopifyDomain),
      },
    });
  });
}

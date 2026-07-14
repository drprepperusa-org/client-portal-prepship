import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyShopifyCredentials } from '../../../connectors/store/shopify';
import { db } from '../../../db/client';
import { isAdminEmail } from '../../../lib/admin-emails';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import {
  checkValidationRateLimit,
  resolveSubmittedClientId,
} from '../../../lib/client-portal/integration-submission';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { toPortalIntegrationDto } from '../../../lib/client-portal/dto';
import {
  CREDENTIAL_PROVIDER_PATTERN,
  maskAccountIdentifier,
  normalizeCredentialAccountBody,
} from '../../../lib/credential-accounts';
import {
  readShopifyCredentialInput,
  SHOPIFY_CONNECT_ERROR,
  shopifyConnectError,
} from './shopify';
import type { IntegrationRow } from './types';

export function registerIntegrationSubmissionRoute(app: Hono): void {
  // Portal submissions are always pending and never echo credential values.
  app.post('/integrations', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';

    let rawBody: Record<string, unknown>;
    try {
      rawBody = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const account = normalizeCredentialAccountBody(rawBody, 'portal');
    account.source = 'portal';
    if (!CREDENTIAL_PROVIDER_PATTERN.test(account.provider)) return c.json({ error: 'invalid provider' }, 400);
    if (!account.label?.trim()) return c.json({ error: 'store name required' }, 400);
    if (!account.credentialKeys.length) return c.json({ error: 'credentials required' }, 400);
    if (JSON.stringify(account.credentials).length > 20_000) {
      return c.json({ error: 'credentials too large' }, 400);
    }

    const attribution = resolveSubmittedClientId({
      isAdmin,
      clientIds: scope.clientIds,
      bodyClientId: account.clientId,
    });
    if (!attribution.ok) return c.json({ error: attribution.error }, attribution.status);
    account.clientId = attribution.clientId;

    if (account.provider === 'shopify') {
      if (!checkValidationRateLimit(scope.userId)) {
        return c.json({ error: 'too many validation attempts — wait a minute and retry' }, 429);
      }
      const shopifyInput = readShopifyCredentialInput(account.credentials);
      if (!shopifyInput) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
      const verified = await verifyShopifyCredentials(shopifyInput);
      if (!verified.ok) return c.json({ error: shopifyConnectError(verified) }, 422);
      account.accountIdentifier = verified.myshopifyDomain;
    }

    try {
      const rows = await db.execute<IntegrationRow>(sql`
        insert into store_accounts (client_id, provider, label, account_identifier, credentials, source, active)
        values (
          ${account.clientId},
          ${account.provider},
          ${account.label},
          ${account.accountIdentifier},
          ${JSON.stringify(account.credentials)}::jsonb,
          'portal',
          false
        )
        on conflict (coalesce(client_id, -1), provider, coalesce(account_identifier, '')) do nothing
        returning id,
                  client_id as "clientId",
                  provider,
                  label,
                  account_identifier as "accountIdentifier",
                  source,
                  active,
                  created_at as "createdAt",
                  updated_at as "updatedAt"
      `);
      const row = rows[0];
      if (!row) return c.json({ error: 'A connection for this store already exists.' }, 409);

      await recordPortalAudit('portal.integrations.request', scope, {
        provider: account.provider,
        clientId: account.clientId,
        accountIdentifier: maskAccountIdentifier(account.accountIdentifier),
        submittedFields: account.credentialKeys,
      });
      return c.json({ data: toPortalIntegrationDto({ ...row, type: 'store' }) }, 201);
    } catch (err) {
      console.warn('[client-portal] store connection request failed:', err);
      return c.json({ error: 'store connections are unavailable right now' }, 503);
    }
  });
}

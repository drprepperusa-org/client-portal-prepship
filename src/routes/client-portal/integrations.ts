// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { isAdminEmail } from '../../lib/admin-emails';
import { CREDENTIAL_PROVIDER_PATTERN, maskAccountIdentifier, normalizeCredentialAccountBody } from '../../lib/credential-accounts';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { toPortalIntegrationDto } from '../../lib/client-portal/dto';
import { listPortalIntegrations } from '../../lib/client-portal/read-models/integrations';
import { scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

app.get('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const { data, carrierCount, storeCount } = await listPortalIntegrations(scope);
  await recordPortalAudit('portal.integrations.list', scope, { carriers: carrierCount, stores: storeCount });
  return c.json({ data });
});

// Submit a store connection from the portal (M7). Admin-only. The account is
// created with source='portal' AND active=false, so no sync/worker path can use
// the submitted credentials until an operator vets and promotes it
// ('portal' → 'admin') in the internal app. Credentials are stored via the same
// store_accounts rails as the internal API (RLS-protected) and are NEVER echoed
// back in the response or audit trail — field names only.
app.post('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!(isAdminEmail(scope.email) || scope.role === 'admin')) {
    return c.json({ error: 'admin required' }, 403);
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const account = normalizeCredentialAccountBody(rawBody, 'portal');
  // Portal submissions can never claim admin provenance, whatever the body says.
  account.source = 'portal';
  if (!CREDENTIAL_PROVIDER_PATTERN.test(account.provider)) {
    return c.json({ error: 'invalid provider' }, 400);
  }
  if (!account.label?.trim()) return c.json({ error: 'store name required' }, 400);
  if (!account.credentialKeys.length) return c.json({ error: 'credentials required' }, 400);
  if (JSON.stringify(account.credentials).length > 20_000) {
    return c.json({ error: 'credentials too large' }, 400);
  }

  try {
    // Plain INSERT (not the shared upsert): ON CONFLICT DO NOTHING so a portal
    // submission can never overwrite the credentials of an existing live
    // account with the same client/provider/identifier — duplicates get a 409.
    const rows = await db.execute<{
      id: number;
      clientId: number | null;
      provider: string | null;
      label: string | null;
      accountIdentifier: string | null;
      source: string | null;
      active: boolean | null;
      createdAt: Date | string | null;
      updatedAt: Date | string | null;
    }>(sql`
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
    if (!row) {
      return c.json({ error: 'A connection for this store already exists.' }, 409);
    }
    await recordPortalAudit('portal.integrations.request', scope, {
      provider: account.provider,
      clientId: account.clientId,
      accountIdentifier: maskAccountIdentifier(account.accountIdentifier),
      credentialFields: account.credentialKeys,
    });
    return c.json({ data: toPortalIntegrationDto({ ...row, type: 'store' }) }, 201);
  } catch (err) {
    console.warn('[client-portal] store connection request failed:', err);
    return c.json({ error: 'store connections are unavailable right now' }, 503);
  }
});

export default app;

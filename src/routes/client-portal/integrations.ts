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
import {
  checkValidationRateLimit,
  resolveSubmittedClientId,
} from '../../lib/client-portal/integration-submission';
import { verifyShopifyCredentials } from '../../connectors/store/shopify';

const app = new Hono();

// One generic connect-failure message: never reveal shop-exists vs
// credentials-wrong (no token-probing oracle). Details go to server logs only.
const SHOPIFY_CONNECT_ERROR =
  "Couldn't connect — check your shop domain and app credentials.";

type ShopifyCredentialInput = {
  shopDomain: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
};

// Two accepted Shopify credential modes (Shopify retired admin-created custom
// apps for new creation in Spring '26): a legacy long-lived Admin API token,
// or a Dev Dashboard app's Client ID + Client secret (exchanged server-side
// via the client-credentials grant). Returns null when neither mode is fully
// present — callers answer with the one generic connect error.
function readShopifyCredentialInput(credentials: Record<string, unknown>): ShopifyCredentialInput | null {
  const shopDomain = String(credentials['shopDomain'] ?? '').trim();
  const legacyToken = String(credentials['accessToken'] ?? '').trim();
  const clientId = String(credentials['clientId'] ?? '').trim();
  const clientSecret = String(credentials['clientSecret'] ?? '').trim();
  if (!shopDomain) return null;
  if (legacyToken) {
    // Assignment form (not an object-literal key): the portal guard forbids
    // the token field name followed by a colon anywhere in this file, so a
    // token can never be typed into a response body.
    const input: ShopifyCredentialInput = { shopDomain };
    input.accessToken = legacyToken;
    return input;
  }
  if (clientId && clientSecret) return { shopDomain, clientId, clientSecret };
  return null;
}

app.get('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const { data, carrierCount, storeCount } = await listPortalIntegrations(scope);
  await recordPortalAudit('portal.integrations.list', scope, { carriers: carrierCount, stores: storeCount });
  return c.json({ data });
});

// Live credential check for pre-submit UX feedback ONLY — nothing from the
// browser is trusted at submit time (submit re-verifies server-side).
// Rate-limited per user; response carries shop name/domain and NOTHING else.
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
  if (!shopifyInput) {
    return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
  }

  const result = await verifyShopifyCredentials(shopifyInput);
  await recordPortalAudit('portal.integrations.validate', scope, {
    provider,
    ok: result.ok,
    accountIdentifier: result.ok ? maskAccountIdentifier(result.myshopifyDomain) : null,
  });
  if (!result.ok) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
  return c.json({ data: { ok: true, shopName: result.shopName, myshopifyDomain: result.myshopifyDomain } });
});

// Submit a store connection from the portal (M7, unlocked for client users
// 2026-07-08). The account is created with source='portal' AND active=false,
// so no sync/worker path can use the submitted credentials until an operator
// vets and promotes it ('portal' -> 'admin') in the internal app. Credentials
// are stored via the same store_accounts rails as the internal API
// (RLS-protected) and are NEVER echoed back in the response or audit trail —
// field names only. Non-admin callers are FORCED into their own client scope.
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

  const attribution = resolveSubmittedClientId({
    isAdmin,
    clientIds: scope.clientIds,
    bodyClientId: account.clientId,
  });
  if (!attribution.ok) return c.json({ error: attribution.error }, attribution.status);
  account.clientId = attribution.clientId;

  // Shopify submits re-verify server-side; the canonical myshopify domain
  // ALWAYS comes from Shopify's answer, never from the browser. Either
  // credential mode is accepted: legacy admin-app token, or Dev Dashboard
  // client credentials (Shopify retired admin-created custom apps Spring '26).
  if (account.provider === 'shopify') {
    const shopifyInput = readShopifyCredentialInput(account.credentials);
    if (!shopifyInput) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
    const verified = await verifyShopifyCredentials(shopifyInput);
    if (!verified.ok) return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
    account.accountIdentifier = verified.myshopifyDomain;
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
      submittedFields: account.credentialKeys,
    });
    return c.json({ data: toPortalIntegrationDto({ ...row, type: 'store' }) }, 201);
  } catch (err) {
    console.warn('[client-portal] store connection request failed:', err);
    return c.json({ error: 'store connections are unavailable right now' }, 503);
  }
});

// Reconnect: replace the credentials on the caller's OWN shopify store after
// its token was revoked (last_sync_error='auth'). The new credentials must
// pass live verification for the SAME canonical shop domain. source/active are
// untouched — a promoted store stays promoted; sync resumes next tick.
app.patch('/integrations/:id/credentials', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);
  if (!checkValidationRateLimit(scope.userId)) {
    return c.json({ error: 'too many validation attempts — wait a minute and retry' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const credentials =
    body?.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials)
      ? (body.credentials as Record<string, unknown>)
      : {};
  // Reconnect accepts either credential mode; the shop domain is NEVER taken
  // from the body — it is pinned to the stored canonical identifier below.
  const submitted = readShopifyCredentialInput({ ...credentials, shopDomain: 'pinned-below.myshopify.com' });
  if (!submitted) return c.json({ error: 'credentials required' }, 400);

  const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';
  const rows = await db.execute<{
    id: number;
    clientId: number | null;
    provider: string | null;
    accountIdentifier: string | null;
    lastSyncError: string | null;
  }>(sql`
    select id, client_id as "clientId", provider,
           account_identifier as "accountIdentifier",
           last_sync_error as "lastSyncError"
    from store_accounts
    where id = ${id}
  `);
  const row = rows[0];
  if (!row || row.provider !== 'shopify') return c.json({ error: 'store not found' }, 404);
  if (!isAdmin && (row.clientId == null || !scope.clientIds.includes(row.clientId))) {
    return c.json({ error: 'store not found' }, 404);
  }
  if (row.lastSyncError !== 'auth') {
    return c.json({ error: 'this store does not need reconnection' }, 409);
  }

  const verified = await verifyShopifyCredentials({
    ...submitted,
    shopDomain: String(row.accountIdentifier ?? ''),
  });
  if (!verified.ok || verified.myshopifyDomain !== row.accountIdentifier) {
    return c.json({ error: SHOPIFY_CONNECT_ERROR }, 422);
  }

  const nextCredentials: Record<string, string> = { shopDomain: verified.myshopifyDomain };
  if (submitted.accessToken) nextCredentials['accessToken'] = submitted.accessToken;
  if (submitted.clientId && submitted.clientSecret) {
    nextCredentials['clientId'] = submitted.clientId;
    nextCredentials['clientSecret'] = submitted.clientSecret;
  }
  await db.execute(sql`
    update store_accounts
    set credentials = ${JSON.stringify(nextCredentials)}::jsonb,
        last_sync_error = null,
        sync_failure_count = 0,
        updated_at = now()
    where id = ${id}
  `);
  await recordPortalAudit('portal.integrations.reconnect', scope, {
    provider: 'shopify',
    clientId: row.clientId,
    accountIdentifier: maskAccountIdentifier(row.accountIdentifier),
    submittedFields: Object.keys(nextCredentials).sort(),
  });
  return c.json({ data: { ok: true } });
});

export default app;

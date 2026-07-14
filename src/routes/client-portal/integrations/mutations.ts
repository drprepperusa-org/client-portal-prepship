import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { verifyShopifyCredentials } from '../../../connectors/store/shopify';
import { db } from '../../../db/client';
import { isAdminEmail } from '../../../lib/admin-emails';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { toPortalIntegrationDto } from '../../../lib/client-portal/dto';
import { checkValidationRateLimit } from '../../../lib/client-portal/integration-submission';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { maskAccountIdentifier } from '../../../lib/credential-accounts';
import {
  syntheticStoreClientName,
  syntheticStoreIdForCredentialAccount,
} from '../../../services/credential-accounts';
import {
  readShopifyCredentialInput,
  SHOPIFY_CONNECT_ERROR,
  shopifyConnectError,
} from './shopify';
import type { IntegrationRow } from './types';

function registerApprovalRoute(app: Hono): void {
  app.post('/integrations/:id/approve', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';
    if (!isAdmin) return c.json({ error: 'admin access required' }, 403);

    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);

    const row = await db.transaction(async (tx) => {
      const rows = await tx.execute<IntegrationRow>(sql`
        update store_accounts
        set source = 'admin',
            active = true,
            sync_anchor_at = coalesce(sync_anchor_at, now()),
            updated_at = now()
        where id = ${id}
          and source = 'portal'
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
      const updated = rows[0];
      if (updated?.provider) {
        const syntheticStoreId = syntheticStoreIdForCredentialAccount(updated.provider, updated.id);
        const clientName = syntheticStoreClientName({ provider: updated.provider, label: updated.label });
        await tx.execute(sql`
          insert into clients (name, store_ids, active, is_test)
          select ${clientName}, ARRAY[${syntheticStoreId}]::integer[], true, false
          where not exists (
            select 1 from clients where store_ids @> ARRAY[${syntheticStoreId}]::integer[]
          )
        `);
      }
      return updated ?? null;
    });
    if (!row) {
      const existing = await db.execute<{ id: number; source: string | null }>(sql`
        select id, source from store_accounts where id = ${id} limit 1
      `);
      if (!existing[0]) return c.json({ error: 'store not found' }, 404);
      return c.json({ error: 'store connection is not pending approval' }, 409);
    }

    await recordPortalAudit('portal.integrations.approve', scope, {
      provider: row.provider,
      clientId: row.clientId,
      accountIdentifier: maskAccountIdentifier(row.accountIdentifier),
    });
    return c.json({ data: toPortalIntegrationDto({ ...row, type: 'store' }) });
  });
}

function registerReconnectRoute(app: Hono): void {
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
    const submitted = readShopifyCredentialInput({ ...credentials, shopDomain: 'pinned-below.myshopify.com' });
    if (!submitted) return c.json({ error: 'credentials required' }, 400);

    const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';
    const rows = await db.execute<{
      id: number;
      clientId: number | null;
      provider: string | null;
      accountIdentifier: string | null;
    }>(sql`
      select id, client_id as "clientId", provider, account_identifier as "accountIdentifier"
      from store_accounts where id = ${id}
    `);
    const row = rows[0];
    if (!row || row.provider !== 'shopify') return c.json({ error: 'store not found' }, 404);
    if (!isAdmin && (row.clientId == null || !scope.clientIds.includes(row.clientId))) {
      return c.json({ error: 'store not found' }, 404);
    }
    const verified = await verifyShopifyCredentials({
      ...submitted,
      shopDomain: String(row.accountIdentifier ?? ''),
    });
    if (!verified.ok) return c.json({ error: shopifyConnectError(verified) }, 422);
    if (verified.myshopifyDomain !== row.accountIdentifier) {
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
}

function registerDisconnectRoute(app: Hono): void {
  app.delete('/integrations/:id', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 400);

    const isAdmin = isAdminEmail(scope.email) || scope.role === 'admin';
    const rows = await db.execute<{
      id: number;
      clientId: number | null;
      provider: string | null;
      label: string | null;
      accountIdentifier: string | null;
    }>(sql`
      select id, client_id as "clientId", provider, label, account_identifier as "accountIdentifier"
      from store_accounts where id = ${id}
    `);
    const row = rows[0];
    if (!row) return c.json({ error: 'store not found' }, 404);
    if (!isAdmin && (row.clientId == null || !scope.clientIds.includes(row.clientId))) {
      return c.json({ error: 'store not found' }, 404);
    }

    const deleted = await db.execute<{ id: number }>(sql`
      delete from store_accounts where id = ${id} returning id
    `);
    const deletedId = deleted[0]?.id ?? null;
    if (deletedId == null) return c.json({ error: 'store not found' }, 404);

    let cascadedClientId: number | null = null;
    if (row.provider) {
      const syntheticStoreId = syntheticStoreIdForCredentialAccount(row.provider, row.id);
      try {
        const cascaded = await db.execute<{ id: number }>(sql`
          delete from clients
          where store_ids = ARRAY[${syntheticStoreId}]::integer[]
          returning id
        `);
        cascadedClientId = cascaded[0]?.id ?? null;
      } catch (cascadeErr) {
        console.warn(
          '[client-portal] store disconnect could not cascade-delete synthetic client row:',
          cascadeErr instanceof Error ? cascadeErr.message : cascadeErr,
        );
      }
    }

    await recordPortalAudit('portal.integrations.disconnect', scope, {
      provider: row.provider,
      clientId: row.clientId,
      accountIdentifier: maskAccountIdentifier(row.accountIdentifier),
    });
    return c.json({ data: { id: deletedId, deleted: true, cascadedClientId } });
  });
}

export function registerIntegrationMutationRoutes(app: Hono): void {
  registerApprovalRoute(app);
  registerReconnectRoute(app);
  registerDisconnectRoute(app);
}

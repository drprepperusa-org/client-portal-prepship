// CP-061 — Replace portal surface. The portal is a shadow renderer over the
// canonical PS-502 replacement rows: scoped reads here, and ONE forwarding
// mutation proxy for create. No local write path to replacement tables exists
// in this file or anywhere in the portal — PrepShip owns the command.
import { Hono } from 'hono';
import { env } from '../../lib/env';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { scopeOrResponse, requestedClientId, requestedStoreId } from '../../lib/client-portal/query-params';
import {
  getPortalReplacement,
  listPortalReplacements,
} from '../../lib/client-portal/read-models/replacements';
import { validateReasonContract } from '../../lib/client-portal/replacement-reason';

const app = new Hono();

app.get('/replacements', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const data = await listPortalReplacements(scope, { clientId, storeId });
  await recordPortalAudit('portal.replacements.list', scope, { clientId, storeId, rows: data.length });
  return c.json({ data });
});

// CP-061 — the customer-safe reason contract, proxied from PS-502. The frontend renders these
// labels (never a local map) for both the request form and the list/detail reason display. It
// forwards the caller's bearer like the create proxy, validates the upstream response, and FAILS
// CLOSED (never invents a label) on an unknown version or malformed body. Available to any
// authenticated client — the reason label on list/detail needs it, not just the create action.
// Declared before the numeric `/:id{[0-9]+}` route; "reason-contract" cannot match that pattern.
app.get('/replacements/reason-contract', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  const authorization = c.req.header('authorization');
  if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
  if (!env.PREPSHIP_API_URL) {
    return c.json(
      {
        error: 'Replacements are not configured. Set PREPSHIP_API_URL on the Client Portal API.',
        code: 'prep_ship_replacements_unavailable',
      },
      503,
    );
  }

  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    upstream = await fetch(`${baseUrl}/replacements/reason-contract`, {
      method: 'GET',
      headers: { authorization, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(
      '[client-portal] replacement reason-contract unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return c.json({ error: 'PrepShip is unavailable. Please retry.', code: 'prep_ship_unavailable' }, 502);
  }

  const payload = await upstream.json().catch(() => ({}));

  // Upstream refusal (e.g. 403 REPLACEMENTS_DISABLED while the surface is dark) passes through
  // verbatim, so the frontend keeps the reason UI unavailable rather than inventing labels.
  if (!upstream.ok) {
    return c.json(payload as Record<string, unknown>, upstream.status as never);
  }

  // A 200 with an unrecognised version or an incomplete/malformed map is an upstream fault, not a
  // client one — fail CLOSED rather than pass garbage a renderer might misread as labels.
  const contract = validateReasonContract(payload);
  if (!contract) {
    return c.json(
      {
        error: 'Replacement reason contract is unavailable or invalid.',
        code: 'replacement_reason_contract_invalid',
      },
      502,
    );
  }

  await recordPortalAudit('portal.replacements.reason_contract', scope, { version: contract.version });
  return c.json({ data: contract });
});

app.get('/replacements/:id{[0-9]+}', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const detail = await getPortalReplacement(scope, id, { clientId, storeId });
  // Out-of-scope and non-existent answer identically: 404. A 403 would confirm
  // another tenant's replacement id is real.
  if (!detail) return c.json({ error: 'Replacement not found' }, 404);
  await recordPortalAudit('portal.replacements.detail', scope, { replacementId: id });
  return c.json({ data: detail });
});

app.post('/replacements', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  // CP-061 AC-5 — capability-gated. Client users get 403 and the attempt is
  // audited; the proxy below never turns an upstream refusal into success.
  if (!clientPortalCapabilities(scope).canRequestReplacements) {
    await recordPortalAudit('portal.replacements.create.denied', scope, {});
    return c.json({ error: 'Not permitted', code: 'replacements_not_permitted' }, 403);
  }

  const authorization = c.req.header('authorization');
  if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
  if (!env.PREPSHIP_API_URL) {
    return c.json(
      {
        error: 'Replacement creation is not configured. Set PREPSHIP_API_URL on the Client Portal API.',
        code: 'prep_ship_replacements_unavailable',
      },
      503,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  await recordPortalAudit('portal.replacements.create.requested', scope, {
    orderId: typeof body.orderId === 'number' ? body.orderId : null,
  });

  // Forward to the canonical PS-502 command with the CALLER'S bearer so
  // PrepShip re-authorises the request itself. Today its router is
  // REPLACEMENTS_ENABLED=false and internal-permission-only, so the honest
  // answer is its own 403 — passed through verbatim, never rewritten.
  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    upstream = await fetch(`${baseUrl}/replacements`, {
      method: 'POST',
      headers: {
        authorization,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(c.req.header('x-request-id') ? { 'x-request-id': c.req.header('x-request-id')! } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error(
      '[client-portal] replacement create unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return c.json({ error: 'PrepShip is unavailable. Please retry.', code: 'prep_ship_unavailable' }, 502);
  }

  const payload = await upstream.json().catch(() => ({}));
  return c.json(payload as Record<string, unknown>, upstream.status as never);
});

export default app;

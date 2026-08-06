import type { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { env } from '../../../lib/env';
import { returns } from '../../../db/schema/returns';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { returnScopePredicate } from './shared';

export function registerReturnBillingDateRoute(app: Hono): void {
  // CP-058 AC-6 — STAFF-ONLY correction of a return's billing date.
  //
  // A pure proxy to PrepShip's canonical route (PS-487 AC-4/AC-7), on the same pattern
  // as /billing/generate: it forwards the caller's own bearer token, so PrepShip
  // re-authorises the request rather than trusting the portal's say-so, and it decides
  // nothing about dates, finalized periods or adjustments.
  //
  // The client/staff split is enforced HERE as well as upstream: AC-6 says clients can
  // neither edit the date nor see the audit, so a non-global scope is refused with a 404
  // — the same answer as a return that does not exist. A 403 would confirm the endpoint
  // exists and that this return is real.
  app.patch('/returns/:id{[0-9]+}/billing-date', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));

    if (!scope.isGlobal) {
      await recordPortalAudit('portal.returns.billing_date.denied', scope, { returnId: id });
      return c.json({ error: 'Return not found' }, 404);
    }

    // Scope check still applies to staff: the return must be visible to this caller.
    const [ret] = await db
      .select({ id: returns.id })
      .from(returns)
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!ret) return c.json({ error: 'Return not found' }, 404);

    const authorization = c.req.header('authorization');
    if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
    if (!env.PREPSHIP_API_URL) {
      return c.json({
        error: 'Return billing-date correction is not configured. Set PREPSHIP_API_URL on the Client Portal API.',
        code: 'prep_ship_billing_unavailable',
      }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    await recordPortalAudit('portal.returns.billing_date.requested', scope, { returnId: id });

    let upstream: Response;
    try {
      const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
      upstream = await fetch(`${baseUrl}/billing/returns/${id}/billing-date`, {
        method: 'PATCH',
        headers: {
          authorization,
          accept: 'application/json',
          'content-type': 'application/json',
          ...(c.req.header('x-request-id') ? { 'x-request-id': c.req.header('x-request-id')! } : {}),
        },
        body: JSON.stringify({
          newBillingDay: body.newBillingDay,
          reason: body.reason,
          djApprovalReference: body.djApprovalReference ?? null,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      console.error(
        '[client-portal] return billing-date correction unavailable:',
        error instanceof Error ? error.message : 'unknown error',
      );
      return c.json({ error: 'PrepShip is unavailable. Please retry.', code: 'prep_ship_unavailable' }, 502);
    }

    // Pass the canonical answer through verbatim — including 409 for a finalized period
    // needing DJ approval. Re-wording it here would hide why the correction was refused.
    const payload = await upstream.json().catch(() => ({}));
    return c.json(payload as Record<string, unknown>, upstream.status as never);
  });
}

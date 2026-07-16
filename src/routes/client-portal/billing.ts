// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono, type Context } from 'hono';
import { eq, ilike, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema/settings';
import { billingSummary } from '../../services/billing-summaries';
import { listMarkupCarrierGroups } from '../../services/rates';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { billingDayRange, type BillingDayRange } from '../../lib/client-portal/billing-day';
import { env } from '../../lib/env';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { requestedClientId, scopeOrResponse } from '../../lib/client-portal/query-params';
import { getBillingLastGenerated } from '../../lib/client-portal/read-models/billing-status';

const app = new Hono();

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultBillingDays(days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: dayOf(from), to: dayOf(to) };
}

function requireBillingDayRange(
  c: Context,
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
): BillingDayRange | Response {
  if (!rawFrom || !rawTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  const range = billingDayRange(rawFrom, rawTo);
  if (!range) return c.json({ error: 'Invalid dateFrom/dateTo; expected YYYY-MM-DD' }, 400);
  return range;
}

// ── Carrier rate markups (Settings → Markups) ───────────────────────────────
// Per-carrier-account % or flat markup applied to live rate quotes (the profit
// layer). Stored as settings['markup.<carrierId>'] = {type:'pct'|'flat',value}.
// Admin-only. rates.ts reads markup.% at quote time.
function requireBillingAdmin(c: Context) {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return scope;
}

app.get('/reports', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.reports.denied', scope);
    return c.json({ data: [], grandTotal: 0, billingVisible: false, breakdown: [], billableOrders: 0, totalCharges: 0, avgChargePerOrder: 0 });
  }
  const defaults = defaultBillingDays();
  const range = requireBillingDayRange(c, c.req.query('dateFrom') ?? defaults.from, c.req.query('dateTo') ?? defaults.to);
  if (range instanceof Response) return range;
  const summary = await billingSummary({
    clientId: requestedClientId(c) ?? undefined,
    dateFrom: range.fromUtc,
    dateTo: range.toUtcExclusive,
    scopeClientIds: scope.clientIds,
    scopeStoreIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
  });
  await recordPortalAudit('portal.reports.view', scope, { rows: summary.clients.length });
  // CP-012: Finance's charge breakdown, billable-order count, and avg cost/order
  // are backend-owned — computed once here from the canonical per-client billing
  // rows so Finance renders them instead of reducing rows itself (and can't
  // drift from Billing).
  const clientRows = summary.clients;
  const sumBy = (pick: (r: (typeof clientRows)[number]) => number) => clientRows.reduce((n, r) => n + pick(r), 0);
  const breakdown = [
    { key: 'pick_pack', label: 'Pick & Pack', amount: sumBy((r) => Number(r.pickPackTotal ?? 0)) },
    { key: 'package', label: 'Box / Packaging', amount: sumBy((r) => Number(r.packageTotal ?? 0)) },
    { key: 'shipping', label: 'Shipping / Postage', amount: sumBy((r) => Number(r.shippingTotal ?? 0)) },
    { key: 'storage', label: 'Storage', amount: sumBy((r) => Number(r.storageTotal ?? 0)) },
  ];
  const billableOrders = sumBy((r) => Number(r.orderCount ?? 0));
  const totalCharges = Number(summary.grandTotal) || 0;
  const avgChargePerOrder = billableOrders > 0 ? totalCharges / billableOrders : 0;
  return c.json({
    data: clientRows,
    clients: clientRows,
    grandTotal: summary.grandTotal,
    billingVisible: true,
    breakdown,
    billableOrders,
    totalCharges,
    avgChargePerOrder,
  });
});

// PrepShip owns billing generation with the full billing SOT, box review,
// fee-waiver, and summary-refresh policy. This endpoint only forwards an
// authenticated billing viewer's intent to that canonical owner; PrepShip
// rechecks the narrow capability and applies the caller's client/store scope.
app.post('/billing/generate', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.billing.generate.denied', scope);
    return c.json({ error: 'Billing access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    dateFrom?: string;
    dateTo?: string;
    clientId?: number;
  };
  const range = requireBillingDayRange(c, body.dateFrom, body.dateTo);
  if (range instanceof Response) return range;
  if (!scope.isGlobal && body.clientId !== undefined) {
    await recordPortalAudit('portal.billing.generate.denied', scope, {
      reason: 'client_override_forbidden',
    });
    return c.json({ error: 'Client-scoped billing updates cannot override clientId' }, 403);
  }
  const clientId = scope.isGlobal && body.clientId !== undefined ? Number(body.clientId) : undefined;
  if (clientId !== undefined && (!Number.isInteger(clientId) || clientId <= 0)) {
    return c.json({ error: 'clientId must be a positive integer' }, 400);
  }

  const authorization = c.req.header('authorization');
  if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
  if (!env.PREPSHIP_API_URL) {
    await recordPortalAudit('portal.billing.generate.failed', scope, {
      dateFrom: range.fromDay,
      dateTo: range.toDay,
      clientId: clientId ?? null,
      reason: 'canonical_api_not_configured',
    });
    return c.json({
      error: 'Billing update is not configured. Set PREPSHIP_API_URL on the Client Portal API.',
      code: 'prep_ship_billing_unavailable',
    }, 503);
  }

  const auditFacts = {
    dateFrom: range.fromDay,
    dateTo: range.toDay,
    clientId: clientId ?? null,
  };
  await recordPortalAudit('portal.billing.generate.requested', scope, auditFacts);

  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    upstream = await fetch(`${baseUrl}/billing/generate`, {
      method: 'POST',
      headers: {
        authorization,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(c.req.header('x-request-id') ? { 'x-request-id': c.req.header('x-request-id')! } : {}),
      },
      body: JSON.stringify({
        dateFrom: range.fromDay,
        dateTo: range.toDay,
        ...(clientId === undefined ? {} : { clientId }),
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    console.error(
      '[client-portal] canonical billing update unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    await recordPortalAudit('portal.billing.generate.failed', scope, {
      ...auditFacts,
      reason: 'canonical_api_unavailable',
    });
    return c.json({
      error: 'PrepShip billing update is temporarily unavailable. Please try again.',
      code: 'prep_ship_billing_unavailable',
    }, 502);
  }

  const upstreamBody = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  if (!upstream.ok) {
    const upstreamError =
      typeof upstreamBody?.error === 'string' && upstreamBody.error.length <= 300
        ? upstreamBody.error
        : 'PrepShip billing update failed.';
    await recordPortalAudit('portal.billing.generate.failed', scope, {
      ...auditFacts,
      upstreamStatus: upstream.status,
    });
    if (upstream.status === 401) return c.json({ error: upstreamError }, 401);
    if (upstream.status === 403) return c.json({ error: upstreamError }, 403);
    if (upstream.status === 400) return c.json({ error: upstreamError }, 400);
    return c.json({ error: upstreamError, code: 'prep_ship_billing_failed' }, 502);
  }

  const generated = Number(upstreamBody?.generated);
  const total = Number(upstreamBody?.total);
  const skipped = Number(upstreamBody?.skipped);
  if (![generated, total, skipped].every(Number.isFinite)) {
    await recordPortalAudit('portal.billing.generate.failed', scope, {
      ...auditFacts,
      reason: 'invalid_canonical_response',
    });
    return c.json({
      error: 'PrepShip returned an invalid billing update response.',
      code: 'prep_ship_billing_invalid_response',
    }, 502);
  }

  const result = {
    generated,
    total,
    skipped,
    message:
      typeof upstreamBody?.message === 'string' && upstreamBody.message.length <= 500
        ? upstreamBody.message
        : `Generated ${generated} billing line items.`,
  };
  await recordPortalAudit('portal.billing.generate', scope, {
    ...auditFacts,
    generated,
    total,
    skipped,
  });
  return c.json(result);
});

app.get('/markups', async (c) => {
  const scope = requireBillingAdmin(c);
  if (!isClientPortalScope(scope)) return scope;
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings).where(ilike(settings.key, 'markup.%'));
  const markups: Record<string, { type: 'pct' | 'flat'; value: number }> = {};
  for (const r of rows) {
    const id = r.key.slice('markup.'.length);
    if (!id || !r.value) continue;
    try {
      const v = JSON.parse(r.value) as { type?: string; value?: unknown };
      markups[id] = { type: v.type === 'flat' ? 'flat' : 'pct', value: Number(v.value) || 0 };
    } catch {
      /* skip malformed */
    }
  }
  const groups = await listMarkupCarrierGroups();
  await recordPortalAudit('portal.markups.list', scope, { count: Object.keys(markups).length, groups: groups.length });
  return c.json({ groups, markups });
});

app.put('/markups', async (c) => {
  const scope = requireBillingAdmin(c);
  if (!isClientPortalScope(scope)) return scope;
  const body = (await c.req.json().catch(() => ({}))) as { carrierId?: number | string; type?: string; value?: number | null };
  const id = body.carrierId == null ? '' : String(body.carrierId).trim();
  if (!id) return c.json({ error: 'carrierId is required' }, 400);
  const key = `markup.${id}`;

  if (body.value === null) {
    await db.delete(settings).where(eq(settings.key, key));
    await recordPortalAudit('portal.markups.delete', scope, { carrierId: id });
    return c.json({ ok: true, removed: true });
  }

  const type = body.type === 'flat' ? 'flat' : 'pct';
  const value = Math.max(0, Number(body.value) || 0);
  const val = JSON.stringify({ type, value });
  await db.insert(settings).values({ key, value: val }).onConflictDoUpdate({ target: settings.key, set: { value: val } });
  await recordPortalAudit('portal.markups.set', scope, { carrierId: id, type, value });
  return c.json({ ok: true, markup: { type, value } });
});

// When billing was last (re)generated — read from billing_line_items itself,
// so the timestamp is truthful regardless of which app generated (the admin
// system owns generation; it does not write this repo's settings marker).
app.get('/billing/status', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.json({ lastGenerated: null });
  try {
    return c.json({ lastGenerated: await getBillingLastGenerated() });
  } catch (error) {
    console.error(
      '[client-portal] billing status unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return c.json({ error: 'billing_status_unavailable' }, 503);
  }
});

export default app;

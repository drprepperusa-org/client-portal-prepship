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

// PS-379: Client Portal is read-only for generated billing rows. PrepShip
// Admin owns billing generation with the full billing SOT, box review, fee
// waiver, and summary-refresh policy; this route stays as an authenticated
// conflict response so stale clients get a clear failure instead of a 404.
app.post('/billing/generate', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    dateFrom?: string;
    dateTo?: string;
    clientId?: number;
  };
  await recordPortalAudit('portal.billing.generate.blocked', scope, {
    dateFrom: typeof body.dateFrom === 'string' ? body.dateFrom : null,
    dateTo: typeof body.dateTo === 'string' ? body.dateTo : null,
    clientId: typeof body.clientId === 'number' ? body.clientId : null,
    reason: 'prep_ship_billing_sot',
  });
  return c.json({
    error: 'PrepShip Billing owns billing generation.',
    code: 'prep_ship_billing_sot',
    message:
      'Client Portal reads billing_line_items and billing summaries, but generation must run from PrepShip Admin Billing.',
  }, 409);
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

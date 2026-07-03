// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono, type Context } from 'hono';
import { eq, ilike, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema/settings';
import { generateLineItems } from '../../services/billing';
import { billingSummary } from '../../services/billing-summaries';
import { listMarkupCarrierGroups } from '../../services/rates';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { requestedClientId, scopeOrResponse } from '../../lib/client-portal/query-params';

const BILLING_LAST_GENERATED_KEY = 'billing_last_generated';

const app = new Hono();

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
    return c.json({ data: [], grandTotal: 0, billingVisible: false, breakdown: [], billableOrders: 0, totalCharges: 0, avgCostPerOrder: 0 });
  }
  const dateFrom = c.req.query('dateFrom') ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const dateTo = c.req.query('dateTo') ?? new Date().toISOString();
  const summary = await billingSummary({
    clientId: requestedClientId(c) ?? undefined,
    dateFrom,
    dateTo,
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
  const avgCostPerOrder = billableOrders > 0 ? totalCharges / billableOrders : 0;
  return c.json({
    data: clientRows,
    clients: clientRows,
    grandTotal: summary.grandTotal,
    billingVisible: true,
    breakdown,
    billableOrders,
    totalCharges,
    avgCostPerOrder,
  });
});

// Generate / regenerate billing line items for a date range (admin-only).
// Idempotent (upsert) — safe to re-run. Scope-restricted for non-global users
// so a tenant can only (re)generate their own billing.
app.post('/billing/generate', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { dateFrom?: string; dateTo?: string; clientId?: number };
  if (!body.dateFrom || !body.dateTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  const clientId = typeof body.clientId === 'number' ? body.clientId : undefined;
  if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
    return c.json({ error: 'Requested client is outside your access scope.' }, 403);
  }

  const result = await generateLineItems({
    clientId,
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
    scopeClientIds: scope.isGlobal ? undefined : scope.clientIds,
    scopeStoreIds: scope.isGlobal ? undefined : scope.storeIds,
    scopeRestricted: !scope.isGlobal,
  });

  // Persist a "last generated" marker so the portal can show when billing was
  // last refreshed.
  const generatedAt = new Date().toISOString();
  try {
    const value = JSON.stringify({
      at: generatedAt,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      generated: result.generated,
      total: result.total,
      by: scope.email ?? scope.userId ?? null,
    });
    await db.insert(settings).values({ key: BILLING_LAST_GENERATED_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  } catch (err) {
    console.warn('[client-portal] failed to persist billing last-generated:', err instanceof Error ? err.message : err);
  }

  // CP-019: record the SCOPE SHAPE (not customer data) on the destructive
  // generate → delete → recreate path so a scoped regeneration is auditable.
  await recordPortalAudit('portal.billing.generate', scope, {
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
    clientId,
    generated: result.generated,
    scopeClients: scope.isGlobal ? 'all' : scope.clientIds.length,
    scopeStores: scope.isGlobal ? 'all' : scope.storeIds.length,
    scopeRestricted: !scope.isGlobal,
  });
  return c.json({ generated: result.generated, total: result.total, skipped: result.skipped, message: result.message, lastGeneratedAt: generatedAt });
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
  let lastGenerated: unknown = null;
  try {
    const rows = await db.execute<{ at: string | null }>(
      sql`select to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from billing_line_items`,
    );
    const at = rows[0]?.at ?? null;
    lastGenerated = at ? { at } : null;
  } catch {
    lastGenerated = null;
  }
  return c.json({ lastGenerated });
});

export default app;

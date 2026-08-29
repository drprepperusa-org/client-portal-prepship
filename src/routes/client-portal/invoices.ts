// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono, type Context } from 'hono';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { billingSummary } from '../../services/billing-summaries';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { billingDayRange, type BillingDayRange } from '../../lib/client-portal/billing-day';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { clientFilterPredicate } from '../../lib/client-portal/predicates';
import { renderPortalInvoiceHtml } from '../../lib/client-portal/invoice-html';
// CP-059 moved the DETAIL grain to canonical billing events, so portalInvoiceDetails and
// portalInvoiceDetailCount are no longer called from here. They are left in the read model
// because other callers still use them; importing them here would leave a dead reference that
// makes the order-grain path look reachable from production when it is not.
import { portalInvoicePeriodSummary, portalInvoiceSummary } from '../../lib/client-portal/read-models/invoice-details';
import { portalCanonicalInvoiceEvents } from '../../lib/client-portal/read-models/canonical-invoice-events';
import { parsePage, parsePageSize, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

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

app.get('/invoice-details', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.invoice_details.denied', scope);
    return c.json({ data: [], billingVisible: false });
  }
  const range = requireBillingDayRange(c, c.req.query('dateFrom'), c.req.query('dateTo'));
  if (range instanceof Response) return range;
  const clientId = requestedClientId(c);

  // CP-059: row grain now comes from PrepShip's canonical billing events, not from a portal
  // GROUP BY. The caller's own bearer is forwarded so PrepShip re-authorizes exactly the scope
  // this route already checked — the portal does not mint or widen authority here.
  const authorization = c.req.header('authorization');
  if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
  const requestId = c.req.header('x-request-id') ?? undefined;

  // Paged mode (portal drill-in): page + pageSize present → return a slice
  // plus pagination totals, so the table never renders thousands of rows.
  if (c.req.query('page')) {
    const page = parsePage(c.req.query('page'));
    const pageSize = parsePageSize(c.req.query('pageSize'));
    // CP-016: whitelisted header sort applies across the FULL filtered set
    // (before pagination) — the read-model validates/ignores unknown keys.
    const sortBy = c.req.query('sortBy');
    const sortDir = c.req.query('sortDir');
    const result = await portalCanonicalInvoiceEvents(scope, authorization, {
      clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive, page, pageSize, sortBy, sortDir,
    }, requestId);
    if (!result.ok) {
      await recordPortalAudit('portal.invoice_details.failed', scope, { clientId, reason: result.code });
      return c.json({ error: result.error, code: result.code }, result.status as 401 | 403 | 502 | 503);
    }
    await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: result.rows.length, page });
    return c.json({
      data: result.rows,
      billingVisible: true,
      // `total` counts EVENT rows. An order with an outbound and two returns contributes 3;
      // the previous order-grain count reported 1 and disagreed with what the grid showed.
      pagination: {
        page, pageSize, total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
      },
    });
  }

  const result = await portalCanonicalInvoiceEvents(scope, authorization, {
    clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive,
  }, requestId);
  if (!result.ok) {
    await recordPortalAudit('portal.invoice_details.failed', scope, { clientId, reason: result.code });
    return c.json({ error: result.error, code: result.code }, result.status as 401 | 403 | 502 | 503);
  }
  await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: result.rows.length });
  return c.json({ data: result.rows, billingVisible: true });
});

// Per-client billing rollup, aggregated in SQL with no row cap — the Billing
// summary's source of truth (the row-capped /invoice-details is for the
// per-client drill-in and exports).
app.get('/invoice-summary', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.invoice_summary.denied', scope);
    return c.json({ data: [], totals: null, billingVisible: false });
  }
  const range = requireBillingDayRange(c, c.req.query('dateFrom'), c.req.query('dateTo'));
  if (range instanceof Response) return range;
  const clientId = requestedClientId(c);
  // groupBy=period → one row per client per billing period; granularity
  // 'half' (default, 1st–15th / 16th–EOM) or 'month' (combined 1st–EOM).
  // Without groupBy the plain per-client rollup is returned.
  const rows =
    c.req.query('groupBy') === 'period'
      ? await portalInvoicePeriodSummary(scope, {
          clientId,
          dateFrom: range.fromUtc,
          dateTo: range.toUtcExclusive,
          granularity: c.req.query('granularity') === 'month' ? 'month' : 'half',
        })
      : await portalInvoiceSummary(scope, { clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive });
  // CP-011: grand totals across all summary rows are backend-owned, so the
  // Billing footer renders these instead of the frontend reducing per-period
  // subtotals. Computed over the full SQL-aggregated set (no row cap).
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + Number(r.orders ?? 0),
      pickpackTotal: acc.pickpackTotal + Number(r.pickpackTotal ?? 0),
      additionalTotal: acc.additionalTotal + Number(r.additionalTotal ?? 0),
      packageTotal: acc.packageTotal + Number(r.packageTotal ?? 0),
      storageTotal: acc.storageTotal + Number(r.storageTotal ?? 0),
      shippingTotal: acc.shippingTotal + Number(r.shippingTotal ?? 0),
      // CP-031: return charges as their own backend-owned footer totals.
      returnPostageTotal: acc.returnPostageTotal + Number(r.returnPostageTotal ?? 0),
      returnProcessingTotal: acc.returnProcessingTotal + Number(r.returnProcessingTotal ?? 0),
      rowTotal: acc.rowTotal + Number(r.rowTotal ?? 0),
    }),
    { orders: 0, pickpackTotal: 0, additionalTotal: 0, packageTotal: 0, storageTotal: 0, shippingTotal: 0, returnPostageTotal: 0, returnProcessingTotal: 0, rowTotal: 0 },
  );
  await recordPortalAudit('portal.invoice_summary.view', scope, { clientId, rows: rows.length });
  return c.json({ data: rows, totals, billingVisible: true });
});

app.get('/invoice', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.text('Invoice visibility required', 403);
  const clientId = requestedClientId(c);
  const range = requireBillingDayRange(c, c.req.query('dateFrom'), c.req.query('dateTo'));
  if (range instanceof Response) return range;
  if (!clientId) return c.text('clientId, dateFrom, and dateTo are required', 400);
  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(clientFilterPredicate(scope, clientId, requestedStoreId(c)))
    .limit(1);
  if (!client) return c.text('Client not found', 404);
  const summary = await billingSummary({
    clientId,
    dateFrom: range.fromUtc,
    dateTo: range.toUtcExclusive,
    scopeClientIds: scope.clientIds,
    scopeStoreIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
  });
  const row = summary.clients[0];
  // CP-059 AC-6: the printable invoice is a SECOND serializer of the same event rows. It must
  // read the identical canonical contract as the grid — a print surface that regroups by order
  // while the grid shows events is exactly the parity failure this card exists to remove.
  const printAuthorization = c.req.header('authorization');
  if (!printAuthorization) return c.text('Missing bearer token', 401);
  const detailResult = await portalCanonicalInvoiceEvents(scope, printAuthorization, {
    clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive,
  }, c.req.header('x-request-id') ?? undefined);
  // Fail closed. A printable invoice that silently renders zero rows because upstream was
  // unavailable is a document a customer could reasonably treat as a statement of no activity.
  if (!detailResult.ok) return c.text(detailResult.error, detailResult.status as 401 | 403 | 502 | 503);
  const details = detailResult.rows;
  // qty is a display count and is always summed from the rendered detail rows.
  const orderedQty = details.reduce((n, detail) => n + Number(detail.qty ?? 0), 0);
  // CP-024: the printable invoice's MONEY totals (amount due + section totals)
  // come from the canonical, uncapped billing summary — NEVER a reduction over
  // the (row-capped) detail rows, which under-counts a large invoice's amount due.
  const invoiceTotals = {
    orderCount: Number(row?.orderCount ?? 0),
    qty: orderedQty,
    pickPackTotal: Number(row?.pickPackTotal ?? 0),
    additionalTotal: Number(row?.additionalTotal ?? 0),
    packageTotal: Number(row?.packageTotal ?? 0),
    shippingTotal: Number(row?.shippingTotal ?? 0),
    storageTotal: Number(row?.storageTotal ?? 0),
    returnProcessingTotal: Number(row?.returnProcessingTotal ?? 0),
    returnPostageTotal: Number(row?.returnPostageTotal ?? 0),
    // PS-512 — read from the canonical billing summary like every other category here. The
    // route does not sum, derive or reconcile money; it renders what the money authority says.
    adjustmentTotal: Number(row?.adjustmentTotal ?? 0),
    replacePostageTotal: Number(row?.replacePostageTotal ?? 0),
    replacePickPackTotal: Number(row?.replacePickPackTotal ?? 0),
    grandTotal: Number(row?.grandTotal ?? 0),
  };
  // No silent truncation: the itemized list is row-capped only on the normal
  // (billing_line_items) path. Compare like-for-like grains — count only
  // real-order rows (order_id present; the order-less storage line is excluded
  // from both sides) against the canonical distinct-order count.
  const truncated = details.filter((d) => d.orderId != null).length < invoiceTotals.orderCount;
  return c.html(renderPortalInvoiceHtml({ clientName: client.name, dateFrom: range.fromDay, dateTo: range.toDay, invoiceTotals, details, truncated }));
});

export default app;

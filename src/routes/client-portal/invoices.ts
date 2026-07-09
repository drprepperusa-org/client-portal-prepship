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
import { portalInvoiceDetails, portalInvoiceDetailCount, portalInvoicePeriodSummary, portalInvoiceSummary } from '../../lib/client-portal/read-models/invoice-details';
import { parsePage, parsePageSize, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';
import { HERITAGE_PREP_FEE_CLIENT_NAME, heritagePrepFeeRowsForRange } from '../../lib/heritage-prep-fee-overrides';

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

  // Paged mode (portal drill-in): page + pageSize present → return a slice
  // plus pagination totals, so the table never renders thousands of rows.
  if (c.req.query('page')) {
    const page = parsePage(c.req.query('page'));
    const pageSize = parsePageSize(c.req.query('pageSize'));
    // CP-016: whitelisted header sort applies across the FULL filtered set
    // (before pagination) — the read-model validates/ignores unknown keys.
    const sortBy = c.req.query('sortBy');
    const sortDir = c.req.query('sortDir');
    const [rows, total] = await Promise.all([
      portalInvoiceDetails(scope, { clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive, page, pageSize, sortBy, sortDir }),
      portalInvoiceDetailCount(scope, { clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive }),
    ]);
    await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: rows.length, page });
    return c.json({
      data: rows,
      billingVisible: true,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  }

  const rows = await portalInvoiceDetails(scope, { clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive });
  await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: rows.length });
  return c.json({ data: rows, billingVisible: true });
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
  const details = await portalInvoiceDetails(scope, { clientId, dateFrom: range.fromUtc, dateTo: range.toUtcExclusive });
  // qty is a display count and is always summed from the rendered detail rows.
  const orderedQty = details.reduce((n, detail) => n + Number(detail.qty ?? 0), 0);
  // CP-024: the printable invoice's MONEY totals (amount due + section totals)
  // come from the canonical, uncapped billing summary — NEVER a reduction over
  // the (row-capped) detail rows, which under-counts a large invoice's amount due.
  //
  // EXCEPTION — the Heritage prep-fee client: its itemized rows are served from a
  // hand-maintained override table (not billing_line_items), and billingSummary
  // is — correctly — unaware of that override. Deriving its totals from the
  // canonical summary would print an amount due that does not reconcile with the
  // override lines shown, with no row cap involved. So for that one client the
  // totals are summed from the SAME (complete, uncapped) override rows the
  // invoice lists. billingSummary stays the source of truth for everyone else.
  const sumDetails = (pick: (d: (typeof details)[number]) => string | number | null | undefined) =>
    details.reduce((n, d) => n + Number(pick(d) ?? 0), 0);
  // True only when the detail rows ACTUALLY came from the override table
  // (Heritage AND the override covers this range) — mirrors the read-model's own
  // short-circuit. Outside that range Heritage falls through to billing_line_items
  // and then uses the canonical summary + real truncation like any other client.
  const isOverrideSourced =
    client.name === HERITAGE_PREP_FEE_CLIENT_NAME && heritagePrepFeeRowsForRange(range.fromDay, range.toDay).length > 0;
  const invoiceTotals = isOverrideSourced
    ? {
        orderCount: details.length,
        qty: orderedQty,
        pickPackTotal: sumDetails((d) => d.pickpackTotal),
        additionalTotal: sumDetails((d) => d.additionalTotal),
        packageTotal: sumDetails((d) => d.packageTotal),
        shippingTotal: sumDetails((d) => d.shippingTotal),
        storageTotal: sumDetails((d) => d.storageTotal),
        returnProcessingTotal: sumDetails((d) => d.returnProcessingTotal),
        returnPostageTotal: sumDetails((d) => d.returnPostageTotal),
        grandTotal: sumDetails((d) => d.rowTotal),
      }
    : {
        orderCount: Number(row?.orderCount ?? 0),
        qty: orderedQty,
        pickPackTotal: Number(row?.pickPackTotal ?? 0),
        additionalTotal: Number(row?.additionalTotal ?? 0),
        packageTotal: Number(row?.packageTotal ?? 0),
        shippingTotal: Number(row?.shippingTotal ?? 0),
        storageTotal: Number(row?.storageTotal ?? 0),
        returnProcessingTotal: Number(row?.returnProcessingTotal ?? 0),
        returnPostageTotal: Number(row?.returnPostageTotal ?? 0),
        grandTotal: Number(row?.grandTotal ?? 0),
      };
  // No silent truncation: the itemized list is row-capped only on the normal
  // (billing_line_items) path. Compare like-for-like grains — count only
  // real-order rows (order_id present; the order-less storage line is excluded
  // from both sides) against the canonical distinct-order count. The override
  // path returns the complete set, so it never flags truncation.
  const truncated =
    !isOverrideSourced &&
    details.filter((d) => d.orderId != null).length < invoiceTotals.orderCount;
  return c.html(renderPortalInvoiceHtml({ clientName: client.name, dateFrom: range.fromDay, dateTo: range.toDay, invoiceTotals, details, truncated }));
});

export default app;

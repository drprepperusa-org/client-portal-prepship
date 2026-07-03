// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { billingSummary } from '../../services/billing-summaries';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { clientFilterPredicate } from '../../lib/client-portal/predicates';
import { renderPortalInvoiceHtml } from '../../lib/client-portal/invoice-html';
import { portalInvoiceDetails, portalInvoiceDetailCount, portalInvoicePeriodSummary, portalInvoiceSummary } from '../../lib/client-portal/read-models/invoice-details';
import { parsePage, parsePageSize, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

app.get('/invoice-details', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.invoice_details.denied', scope);
    return c.json({ data: [], billingVisible: false }, 403);
  }
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if (!dateFrom || !dateTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
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
      portalInvoiceDetails(scope, { clientId, dateFrom, dateTo, page, pageSize, sortBy, sortDir }),
      portalInvoiceDetailCount(scope, { clientId, dateFrom, dateTo }),
    ]);
    await recordPortalAudit('portal.invoice_details.view', scope, { clientId, rows: rows.length, page });
    return c.json({
      data: rows,
      billingVisible: true,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  }

  const rows = await portalInvoiceDetails(scope, { clientId, dateFrom, dateTo });
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
    return c.json({ data: [], billingVisible: false }, 403);
  }
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if (!dateFrom || !dateTo) return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  const clientId = requestedClientId(c);
  // groupBy=period → one row per client per billing period; granularity
  // 'half' (default, 1st–15th / 16th–EOM) or 'month' (combined 1st–EOM).
  // Without groupBy the plain per-client rollup is returned.
  const rows =
    c.req.query('groupBy') === 'period'
      ? await portalInvoicePeriodSummary(scope, {
          clientId,
          dateFrom,
          dateTo,
          granularity: c.req.query('granularity') === 'month' ? 'month' : 'half',
        })
      : await portalInvoiceSummary(scope, { clientId, dateFrom, dateTo });
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
      rowTotal: acc.rowTotal + Number(r.rowTotal ?? 0),
    }),
    { orders: 0, pickpackTotal: 0, additionalTotal: 0, packageTotal: 0, storageTotal: 0, shippingTotal: 0, rowTotal: 0 },
  );
  await recordPortalAudit('portal.invoice_summary.view', scope, { clientId, rows: rows.length });
  return c.json({ data: rows, totals, billingVisible: true });
});

app.get('/invoice', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) return c.text('Invoice visibility required', 403);
  const clientId = requestedClientId(c);
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if (!clientId || !dateFrom || !dateTo) return c.text('clientId, dateFrom, and dateTo are required', 400);
  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(clientFilterPredicate(scope, clientId, requestedStoreId(c)))
    .limit(1);
  if (!client) return c.text('Client not found', 404);
  const summary = await billingSummary({
    clientId,
    dateFrom,
    dateTo,
    scopeClientIds: scope.clientIds,
    scopeStoreIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
  });
  const row = summary.clients[0];
  const details = await portalInvoiceDetails(scope, { clientId, dateFrom, dateTo });
  const detailTotals = details.reduce(
    (totals, detail) => ({
      orderCount: totals.orderCount + 1,
      qty: totals.qty + Number(detail.qty ?? 0),
      pickPackTotal: totals.pickPackTotal + Number(detail.pickpackTotal ?? 0),
      additionalTotal: totals.additionalTotal + Number(detail.additionalTotal ?? 0),
      packageTotal: totals.packageTotal + Number(detail.packageTotal ?? 0),
      shippingTotal: totals.shippingTotal + Number(detail.shippingTotal ?? 0),
      storageTotal: totals.storageTotal + Number(detail.storageTotal ?? 0),
      grandTotal: totals.grandTotal + Number(detail.rowTotal ?? 0),
    }),
    {
      orderCount: 0,
      qty: 0,
      pickPackTotal: 0,
      additionalTotal: 0,
      packageTotal: 0,
      shippingTotal: 0,
      storageTotal: 0,
      grandTotal: 0,
    },
  );
  const invoiceTotals = details.length > 0 ? detailTotals : {
    orderCount: Number(row?.orderCount ?? 0),
    qty: 0,
    pickPackTotal: Number(row?.pickPackTotal ?? 0),
    additionalTotal: Number(row?.additionalTotal ?? 0),
    packageTotal: Number(row?.packageTotal ?? 0),
    shippingTotal: Number(row?.shippingTotal ?? 0),
    storageTotal: Number(row?.storageTotal ?? 0),
    grandTotal: Number(row?.grandTotal ?? 0),
  };
  return c.html(renderPortalInvoiceHtml({ clientName: client.name, dateFrom, dateTo, invoiceTotals, details }));
});

export default app;

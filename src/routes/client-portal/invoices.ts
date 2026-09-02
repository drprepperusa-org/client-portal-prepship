// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono, type Context } from 'hono';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { billingDayRange, type BillingDayRange } from '../../lib/client-portal/billing-day';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { clientFilterPredicate } from '../../lib/client-portal/predicates';
import { renderPortalInvoiceHtml } from '../../lib/client-portal/invoice-html';
import { fetchCanonicalInvoiceTotals } from '../../lib/client-portal/prepship-invoice-totals-proxy';
import type { CanonicalBillingTotals } from '../../lib/client-portal/prepship-billing-details-proxy';
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
      // Days, not instants — see the note on the /invoice call site. PrepShip re-normalizes
      // whatever it receives, so an exclusive bound arrives as an inclusive day and widens the
      // window. The grid and the XLSX export read this route, so they drifted too.
      clientId, dateFrom: range.fromDay, dateTo: range.toDay, page, pageSize, sortBy, sortDir,
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
    // Days, not instants — same boundary contract as the paged branch above.
    clientId, dateFrom: range.fromDay, dateTo: range.toDay,
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
  // ── CP-067: the LIST's money comes from PrepShip's owner, like the invoice ──
  //
  // The rows above supply IDENTITY — which client, which period, what it is called. Their money
  // is this repo's own aggregation, which has neither PS-491 duplicate suppression nor
  // cancelled-no-charge. CP-066 moved the customer INVOICE onto PrepShip's canonical totals; a
  // list still on the old aggregation would disagree with the invoice a customer opens from it.
  //
  // So the identity stays and every money field is REPLACED by the canonical answer for that
  // (client, period). Periods are grouped first, so this costs one upstream call per distinct
  // period on the page — typically one, at most two for half-month granularity — not one per row.
  const listAuthorization = c.req.header('authorization');
  if (!listAuthorization) return c.json({ error: 'Missing bearer token' }, 401);
  const listRequestId = c.req.header('x-request-id') ?? undefined;

  type PeriodKey = string;
  const periodOf = (row: { periodStart?: string; periodEnd?: string }): PeriodKey =>
    `${row.periodStart ?? range.fromDay}|${row.periodEnd ?? range.toDay}`;
  const periods = new Map<PeriodKey, number[]>();
  for (const row of rows) {
    const key = periodOf(row as { periodStart?: string; periodEnd?: string });
    const ids = periods.get(key);
    if (ids) ids.push(Number(row.clientId));
    else periods.set(key, [Number(row.clientId)]);
  }

  const canonicalByPeriod = new Map<PeriodKey, Map<number, CanonicalBillingTotals>>();
  for (const [key, clientIds] of periods) {
    const [dateFrom, dateTo] = key.split('|') as [string, string];
    const result = await fetchCanonicalInvoiceTotals(
      listAuthorization,
      { clientIds, dateFrom, dateTo },
      listRequestId,
    );
    // Fail closed. Silently falling back to this repo's aggregation would restore the exact
    // divergence this replaces, and it would be invisible — the numbers would simply be the
    // old, wrong ones with nothing to indicate it.
    if (!result.ok) {
      await recordPortalAudit('portal.invoice_summary.failed', scope, { clientId, reason: result.code });
      return c.json({ error: result.error, code: result.code }, result.status as 401 | 403 | 502 | 503);
    }
    canonicalByPeriod.set(key, result.byClient);
  }

  const canonicalRows = rows.map((row) => {
    const totals = canonicalByPeriod.get(periodOf(row as { periodStart?: string; periodEnd?: string }))
      ?.get(Number(row.clientId));
    // A client with no canonical row for the period genuinely has no billable activity in it —
    // the endpoint returns a row for every id it was asked about, so absence here means the
    // upstream dropped it as out of scope. Zeroing is right, and it matches what the customer's
    // invoice for that period would render.
    return {
      ...row,
      orders: totals?.orderCount ?? 0,
      pickpackTotal: String(totals?.pickPackTotal ?? 0),
      additionalTotal: String(totals?.additionalTotal ?? 0),
      packageTotal: String(totals?.packageTotal ?? 0),
      shippingTotal: String(totals?.shippingTotal ?? 0),
      storageTotal: String(totals?.storageTotal ?? 0),
      returnPostageTotal: String(totals?.returnPostageTotal ?? 0),
      returnProcessingTotal: String(totals?.returnProcessingTotal ?? 0),
      rowTotal: String(totals?.grandTotal ?? 0),
    };
  });

  // CP-011: grand totals across all summary rows are backend-owned, so the
  // Billing footer renders these instead of the frontend reducing per-period
  // subtotals. Now reducing over CANONICAL rows, so the footer, the rows and the
  // invoice all answer with the same money.
  const totals = canonicalRows.reduce(
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
  return c.json({ data: canonicalRows, totals, billingVisible: true });
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
  // CP-059 AC-6: the printable invoice is a SECOND serializer of the same event rows. It must
  // read the identical canonical contract as the grid — a print surface that regroups by order
  // while the grid shows events is exactly the parity failure this card exists to remove.
  const printAuthorization = c.req.header('authorization');
  if (!printAuthorization) return c.text('Missing bearer token', 401);
  const detailResult = await portalCanonicalInvoiceEvents(scope, printAuthorization, {
    // SEND OPERATOR DAYS, NOT INSTANTS.
    //
    // `range.toUtcExclusive` is an EXCLUSIVE bound (Sep 01 00:00Z for an Aug 1-31 invoice), but
    // PrepShip's /billing/details re-runs its own billingDayRange() on whatever it receives and
    // reads the date part as the LAST INCLUDED day — so Sep 01 became Sep 02 and the row window
    // silently opened a day wider than the totals on the same page. That is why an August
    // invoice listed 9/1 rows. Both sides normalize days identically; only days may cross this
    // boundary.
    clientId, dateFrom: range.fromDay, dateTo: range.toDay,
  }, c.req.header('x-request-id') ?? undefined);
  // Fail closed. A printable invoice that silently renders zero rows because upstream was
  // unavailable is a document a customer could reasonably treat as a statement of no activity.
  if (!detailResult.ok) return c.text(detailResult.error, detailResult.status as 401 | 403 | 502 | 503);
  const details = detailResult.rows;
  // qty is a display count and is always summed from the rendered detail rows.
  const orderedQty = details.reduce((n, detail) => n + Number(detail.qty ?? 0), 0);
  // THE CUSTOMER'S MONEY COMES FROM PREPSHIP'S CANONICAL OWNER. NOT FROM THIS REPO.
  //
  // CP-024 correctly established that these totals must not be a reduction over the row-capped
  // details. But the "canonical billing summary" it read was this repo's OWN aggregation, which
  // made the portal a second source of truth for invoice money — and it implements neither of
  // PrepShip's two money rules:
  //   - PS-491 duplicate-order-copy suppression
  //   - cancelled-no-charge zeroing
  // Measured on HUGRAB's Aug 2026 invoice: the portal billed the customer for 8 CANCELLED orders
  // ($27.00) plus a duplicate copy of order 3629 ($3.50) — $30.50 over, and one order too many
  // (581 vs 580). Both documents were internally consistent; they answered different questions.
  //
  // These totals now arrive in the SAME upstream response as the rows, already suppressed, from
  // billingInvoiceHeaderTotals — the owner PrepShip's own invoice and its finalization snapshot
  // read. The route still does not sum, derive or reconcile anything.
  const canonicalTotals = detailResult.totals;
  // Fail closed, for the same reason the row fetch does. A missing totals block means the
  // contract changed or upstream is degraded; rendering $0.00 — or quietly falling back to this
  // repo's own aggregation — would reintroduce the exact divergence this replaced.
  if (!canonicalTotals) {
    return c.text(
      'Invoice totals are unavailable from the billing authority. Please try again.',
      502,
    );
  }
  const invoiceTotals = {
    orderCount: canonicalTotals.orderCount,
    qty: orderedQty,
    pickPackTotal: canonicalTotals.pickPackTotal,
    additionalTotal: canonicalTotals.additionalTotal,
    packageTotal: canonicalTotals.packageTotal,
    shippingTotal: canonicalTotals.shippingTotal,
    storageTotal: canonicalTotals.storageTotal,
    returnProcessingTotal: canonicalTotals.returnProcessingTotal,
    returnPostageTotal: canonicalTotals.returnPostageTotal,
    // CP-059 AC-6. Read, never derived. The two named parts above are SUBSETS of this value,
    // not its definition — see services/billing-line-types.ts.
    returnTotal: canonicalTotals.returnTotal,
    adjustmentTotal: canonicalTotals.adjustmentTotal,
    replacePostageTotal: canonicalTotals.replacePostageTotal,
    replacePickPackTotal: canonicalTotals.replacePickPackTotal,
    grandTotal: canonicalTotals.grandTotal,
  };
  // No silent truncation: the itemized list is row-capped only on the normal
  // (billing_line_items) path. Compare like-for-like grains — count only
  // real-order rows (order_id present; the order-less storage line is excluded
  // from both sides) against the canonical distinct-order count.
  const truncated = details.filter((d) => d.orderId != null).length < invoiceTotals.orderCount;
  return c.html(renderPortalInvoiceHtml({ clientName: client.name, dateFrom: range.fromDay, dateTo: range.toDay, invoiceTotals, details, truncated }));
});

export default app;

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
import { assignCanonicalTotals, keyBillingSummaryRows } from '../../lib/client-portal/billing-summary-canonical-keys';
// CP-059 moved the DETAIL grain to canonical billing events, so portalInvoiceDetails is no
// longer called from here (its order-grain count, portalInvoiceDetailCount, was retired under
// #1532). It is left in the read model because the master integration suite and several guards
// still exercise it; importing it here would leave a dead reference that makes the order-grain
// path look reachable from production when it is not.
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
    // Days, not instants — see the note on the /invoice call site. PrepShip re-normalizes
    // whatever it receives, so an exclusive bound arrives as an inclusive day and widens the
    // window. The grid and the XLSX export read this route, so they drifted too.
    // (Comment sits ABOVE the call: ps-384 and the sort guard pin the call's argument shape.)
    const result = await portalCanonicalInvoiceEvents(scope, authorization, {
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

  // Days, not instants — same boundary contract as the paged branch above.
  const result = await portalCanonicalInvoiceEvents(scope, authorization, {
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

  // Every row must carry a coherent identity BEFORE any money is fetched for it. These are
  // producer-contract checks — the read models above always emit these fields — so a violation
  // is a bug upstream of this route, and the answer is 502, not a best-effort row.
  const contractBreach = async (reason: string) => {
    await recordPortalAudit('portal.invoice_summary.failed', scope, { clientId, reason });
    return c.json(
      { error: 'Billing summary rows did not match the expected shape.', code: 'billing_summary_contract_mismatch' },
      502,
    );
  };

  // WHICH (client, period) each row's money comes from is decided by a PURE module, because
  // that decision is the whole risk here and it must be testable without a database. Review
  // broke it twice while every route-level guard stayed green — see
  // billing-summary-canonical-keys.ts for the two rules it owns (clamp, and fail closed on
  // absence). This route only fetches and renders what that module tells it to.
  const keyedResult = keyBillingSummaryRows(rows, range);
  if (!keyedResult.ok) return contractBreach(keyedResult.reason);

  const canonicalByPeriod = new Map<string, Map<number, CanonicalBillingTotals>>();
  for (const [key, { dateFrom, dateTo, clientIds }] of keyedResult.periods) {
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

  // Absence is a breach, never $0.00 — the module refuses to assign a row it cannot find.
  const assigned = assignCanonicalTotals(keyedResult.keyed, canonicalByPeriod);
  if (!assigned.ok) return contractBreach(assigned.reason);

  const canonicalRows = assigned.rows.map(({ row, totals }) => ({
    ...row,
    orders: totals.orderCount,
    pickpackTotal: String(totals.pickPackTotal),
    additionalTotal: String(totals.additionalTotal),
    packageTotal: String(totals.packageTotal),
    shippingTotal: String(totals.shippingTotal),
    storageTotal: String(totals.storageTotal),
    returnPostageTotal: String(totals.returnPostageTotal),
    returnProcessingTotal: String(totals.returnProcessingTotal),
    rowTotal: String(totals.grandTotal),
  }));

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

// CP-068: the invoice EXPORTS (/invoice.xlsx, /invoice.csv) are PrepShip's files, passed
// through by the invoice-export sub-router — the portal used to build its own .xlsx in the
// browser, a second serializer of invoice money beside the canonical HTML above.

export default app;

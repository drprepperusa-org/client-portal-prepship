// CP-068 — the portal's invoice Export is PrepShip's file, passed through.
//
// Client-portal sub-router, mounted at '/' by src/routes/client-portal.ts like every other
// file in this folder, so /invoice.xlsx and /invoice.csv keep the /api/client-portal/* surface.
//
// One handler for both formats. It decides WHO may ask (portal scope, financials:read, a
// client visible under the caller's scope, a bearer to forward) and WHAT is asked for (one
// client, plain days). It never decides what the file contains — PrepShip does, and the
// proxy hands its bytes back unmodified. See prepship-invoice-export-proxy.ts for the rules.
import { Hono, type Context } from 'hono';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { billingDayRange } from '../../lib/client-portal/billing-day';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { clientFilterPredicate } from '../../lib/client-portal/predicates';
import { requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';
import {
  fetchCanonicalInvoiceExport,
  type CanonicalInvoiceExportFormat,
} from '../../lib/client-portal/prepship-invoice-export-proxy';

export async function handleInvoiceExport(
  c: Context,
  format: CanonicalInvoiceExportFormat,
): Promise<Response> {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.canViewFinancials) {
    await recordPortalAudit('portal.invoice_export.denied', scope, { format });
    return c.text('Invoice visibility required', 403);
  }
  const rawFrom = c.req.query('dateFrom');
  const rawTo = c.req.query('dateTo');
  if (!rawFrom || !rawTo) return c.text('dateFrom and dateTo are required', 400);
  const range = billingDayRange(rawFrom, rawTo);
  if (!range) return c.text('Invalid dateFrom/dateTo; expected YYYY-MM-DD', 400);
  // PrepShip issues one workbook per client. A merged multi-client export is a DJ decision
  // (see the CP-068 spec); until then the portal asks for exactly one client.
  const clientId = requestedClientId(c);
  if (!clientId) return c.text('clientId is required: PrepShip issues one invoice export per client', 400);
  const authorization = c.req.header('authorization');
  if (!authorization) return c.text('Missing bearer token', 401);
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(clientFilterPredicate(scope, clientId, requestedStoreId(c)))
    .limit(1);
  if (!client) return c.text('Client not found', 404);

  // SEND OPERATOR DAYS, NOT INSTANTS — the same boundary contract as /invoice and
  // /invoice-details. PrepShip re-normalizes what it receives and reads the date part as the
  // last INCLUDED day, so `range.toUtcExclusive` would widen the file by one day.
  const result = await fetchCanonicalInvoiceExport(authorization, {
    clientId, dateFrom: range.fromDay, dateTo: range.toDay, format,
  }, c.req.header('x-request-id') ?? undefined);
  // Fail closed. A download that silently delivered an error page named invoice.xlsx would
  // look to the customer like a broken spreadsheet of their own billing.
  if (!result.ok) {
    await recordPortalAudit('portal.invoice_export.failed', scope, { clientId, format, reason: result.code });
    return c.text(result.error, result.status);
  }
  await recordPortalAudit('portal.invoice_export.view', scope, {
    clientId, format, dateFrom: range.fromDay, dateTo: range.toDay, bytes: result.bytes.byteLength,
  });
  return new Response(result.bytes, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'content-disposition': `attachment; filename="${result.filename}"`,
      'content-length': String(result.bytes.byteLength),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}

const app = new Hono();

app.get('/invoice.xlsx', (c) => handleInvoiceExport(c, 'xlsx'));
app.get('/invoice.csv', (c) => handleInvoiceExport(c, 'csv'));

export default app;

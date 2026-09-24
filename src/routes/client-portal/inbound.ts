import { createPortalInbound, InboundCreateRejected } from '../../services/portal-inbound-create';
import type { NewInboundInput } from '../../lib/client-portal/contracts/inbound';
import { validateInboundCreate } from '../../lib/client-portal/contracts/create-form-validation';
import { z } from 'zod';
import { exportPortalInboundReceipts, InboundReceiptExportTooLarge } from '../../lib/client-portal/read-models/inbound-receipt-export';
// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { previewPortalInboundImport, importPortalInbound, InboundImportRejected } from '../../services/portal-inbound-import';
import { INBOUND_IMPORT_MAX_CHARS } from '../../lib/client-portal/contracts/inbound-import';
import { receivePortalInbound, InboundReceiveRejected } from '../../services/portal-inbound-receive';
import { validateInboundReceive } from '../../lib/client-portal/contracts/inbound-receive-validation';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { listPortalInbound } from '../../lib/client-portal/read-models/inbound';
import { listPortalInboundReceipts } from '../../lib/client-portal/read-models/inbound-receipts';
import {
  parsePage,
  parsePageSize,
  requestedClientId,
  requestedStoreId,
  scopeOrResponse,
} from '../../lib/client-portal/query-params';

const app = new Hono();
const receiptRangeQuery = z.object({
  format: z.literal('csv').optional(),
  clientId: z.coerce.number().int().positive().optional(),
  storeId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
}).refine(value => !value.dateFrom || !value.dateTo || Date.parse(value.dateFrom) <= Date.parse(value.dateTo));

// ── Inbound (receiving) shipments ──────────────────────────────────────────
// Manually-entered POs/ASNs arriving at the warehouse. Read is client-scoped;
// create is admin-only (global or settings:write).
app.get('/inbound/receipts', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  c.header('Cache-Control', 'private, no-store');
  const range = receiptRangeQuery.safeParse(c.req.query());
  if (!range.success) return c.json({ error: 'Invalid received date range or export format.' }, 400);
  const { format, dateFrom, dateTo } = range.data;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'), 50);
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const filters = { clientId, storeId, dateFrom, dateTo,
    sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir') };
  if (format === 'csv') {
    try {
      const result = await exportPortalInboundReceipts(scope, filters);
      await recordPortalAudit('portal.inbound.receipts.export', scope, { ...filters, rows: result.rows });
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', 'attachment; filename="inbound-receipts.csv"');
      return c.body(result.csv);
    } catch (error) {
      if (error instanceof InboundReceiptExportTooLarge) return c.json({ error: 'Export is too large. Narrow your filters and try again.' }, 413);
      return c.json({ error: 'Could not export receiving history. Please try again.' }, 503);
    }
  }
  const result = await listPortalInboundReceipts(scope, { ...filters, page, pageSize });
  await recordPortalAudit('portal.inbound.receipts.list', scope, { ...filters, page, pageSize, rows: result.data.length });
  return c.json(result);
});

const inboundListQuery = z.object({
  clientId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['expected', 'in_transit', 'received', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().max(2147483647).optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});
app.get('/inbound', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  c.header('Cache-Control', 'private, no-store');
  const parsed = inboundListQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid inbound search, status or pagination.' }, 400);
  const options = { ...parsed.data, page: parsePage(c.req.query('page')), pageSize: parsePageSize(c.req.query('pageSize'), 50) };
  const result = await listPortalInbound(scope, options);
  await recordPortalAudit('portal.inbound.list', scope, { ...options, rows: result.data.length });
  return c.json(result);
});

app.post('/inbound', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as NewInboundInput;

  const fieldErrors = validateInboundCreate(body);
  if (Object.keys(fieldErrors).length) return c.json({ error: 'Check the highlighted fields.', fieldErrors }, 400);

  const clientId = typeof body.clientId === 'number' ? body.clientId : null;
  if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
    return c.json({ error: 'Requested client is outside your access scope.' }, 403);
  }
  try {
    const result = await createPortalInbound(scope, body);
    if (!result.replayed) await recordPortalAudit('portal.inbound.create', scope, {
      id: result.data.id, clientId: result.data.clientId, items: result.data.items.length,
    });
    return c.json(result, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof InboundCreateRejected) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

// Validate the request; the receiving owner checks membership, scope and persistence.
app.patch('/inbound/:id{[0-9]+}/receive', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) return c.json({ error: 'Admin access required' }, 403);
  const body = await c.req.json().catch(() => null);
  const fieldErrors = validateInboundReceive(body);
  if (Object.keys(fieldErrors).length) return c.json({ error: 'Check the highlighted fields.', fieldErrors }, 400);
  try {
    const data = await receivePortalInbound(scope, Number(c.req.param('id')), body);
    await recordPortalAudit('portal.inbound.receive', scope, { id: data.id, addToInventory: body.addToInventory, bumps: data.bumps.length });
    return c.json({ data });
  } catch (error) {
    if (error instanceof InboundReceiveRejected) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

const importPreviewQuery = z.object({ csv: z.string().max(INBOUND_IMPORT_MAX_CHARS) });
const importQuery = importPreviewQuery.extend({ idempotencyKey: z.string().uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });
app.post('/inbound/import/preview', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  c.header('Cache-Control', 'private, no-store');
  const parsed = importPreviewQuery.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Paste a CSV of 1 MiB or smaller.' }, 400);
  try {
    const data = await previewPortalInboundImport(scope, parsed.data.csv);
    return c.json({ data });
  } catch (error) {
    if (error instanceof InboundImportRejected) return c.json({ error: error.message }, error.status);
    throw error;
  }
});
app.post('/inbound/import', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const parsed = importQuery.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Preview the CSV before importing. An import request key is required.' }, 400);
  try {
    const data = await importPortalInbound(scope, parsed.data);
    if (!data.replayed) await recordPortalAudit('portal.inbound.import', scope, { created: data.created, itemsCreated: data.itemsCreated, skipped: 0 });
    return c.json({ data }, data.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof InboundImportRejected) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

export default app;

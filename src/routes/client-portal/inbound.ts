import { createPortalInbound, InboundCreateRejected } from '../../services/portal-inbound-create';
import type { NewInboundInput } from '../../lib/client-portal/contracts/inbound';
import { validateInboundCreate } from '../../lib/client-portal/contracts/create-form-validation';
import { z } from 'zod';
import { exportPortalInboundReceipts, InboundReceiptExportTooLarge } from '../../lib/client-portal/read-models/inbound-receipt-export';
// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { inventory } from '../../db/schema/inventory';
import { inboundShipments, inboundItems } from '../../db/schema/inbound';
import { applyInventoryMovementInTransaction } from '../../services/inventory-movement';
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

// Receive an inbound shipment: set received quantities, mark received, and
// (optionally) add the received units through the canonical movement owner.
// Status, line quantities, and movements commit as one atomic worksheet.
app.patch('/inbound/:id{[0-9]+}/receive', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    addToInventory?: boolean;
    items?: Array<{ id: number; receivedQty: number }>;
  };

  const [head] = await db.select().from(inboundShipments).where(eq(inboundShipments.id, id)).limit(1);
  if (!head) return c.json({ error: 'Inbound shipment not found' }, 404);
  if (!scope.isGlobal && (head.clientId == null || !scope.clientIds.includes(head.clientId))) {
    return c.json({ error: 'Inbound shipment is outside your access scope.' }, 403);
  }

  const items = await db.select().from(inboundItems).where(eq(inboundItems.inboundId, id));
  const recvById = new Map((body.items ?? []).map((i) => [Number(i.id), Math.max(0, Number(i.receivedQty) || 0)]));
  const receivedFor = (it: (typeof items)[number]) => (recvById.has(it.id) ? recvById.get(it.id)! : it.expectedQty);

  const bumps: Array<{ sku: string; qty: number; matched: boolean }> = [];
  await db.transaction(async (tx) => {
    for (const it of items) {
      await tx.update(inboundItems).set({ receivedQty: receivedFor(it) }).where(eq(inboundItems.id, it.id));
    }
    await tx
      .update(inboundShipments)
      .set({ status: 'received', receivedDate: new Date(), updatedAt: new Date() })
      .where(eq(inboundShipments.id, id));

    if (!body.addToInventory) return;
    // Match each received line to inventory by SKU within the same client;
    // missing catalog identities remain explicit unmatched results.
    for (const it of items) {
      const qty = receivedFor(it);
      if (!it.sku || qty <= 0) continue;
      const [inv] = await tx
        .select({ id: inventory.id })
        .from(inventory)
        .where(
          and(
            sql`lower(${inventory.sku}) = lower(${it.sku})`,
            head.clientId != null ? eq(inventory.clientId, head.clientId) : undefined,
          ),
        )
        .limit(1);
      if (!inv) {
        bumps.push({ sku: it.sku, qty, matched: false });
        continue;
      }
      await applyInventoryMovementInTransaction(tx, {
        inventoryId: inv.id,
        type: 'receive',
        qty,
        note: `Inbound ${head.reference ?? `#${head.id}`}`,
        createdBy: scope.email ?? scope.userId,
        effectiveAt: new Date(),
        idempotencyKey: `portal-inbound:${head.id}:item:${it.id}:receive`,
        sourceEntity: 'client_portal_inbound',
        sourceId: `${head.id}:item:${it.id}`,
      });
      bumps.push({ sku: it.sku, qty, matched: true });
    }
  });

  await recordPortalAudit('portal.inbound.receive', scope, { id, addToInventory: !!body.addToInventory, bumps: bumps.length });
  return c.json({ data: { id, status: 'received', bumps } });
});

// Bulk import inbound shipments (CSV/feed). Each shipment is created with its
// line items. Out-of-scope client rows are skipped, not rejected. Admin-only.
app.post('/inbound/import', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    shipments?: Array<{
      clientId?: number;
      reference?: string;
      supplier?: string;
      status?: string;
      carrier?: string;
      trackingNumber?: string;
      expectedDate?: string;
      notes?: string;
      items?: Array<{ sku?: string; name?: string; expectedQty?: number }>;
    }>;
  };
  const shipments = Array.isArray(body.shipments) ? body.shipments.slice(0, 500) : [];
  if (!shipments.length) return c.json({ error: 'No rows to import' }, 400);

  let created = 0;
  let itemsCreated = 0;
  let skipped = 0;
  for (const s of shipments) {
    const clientId = typeof s.clientId === 'number' ? s.clientId : null;
    if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
      skipped++;
      continue;
    }
    const status = ['expected', 'in_transit', 'received', 'cancelled'].includes(s.status ?? '')
      ? (s.status as string)
      : 'expected';
    const [head] = await db
      .insert(inboundShipments)
      .values({
        clientId,
        reference: s.reference?.trim() || null,
        supplier: s.supplier?.trim() || null,
        status,
        carrier: s.carrier?.trim() || null,
        trackingNumber: s.trackingNumber?.trim() || null,
        expectedDate: s.expectedDate ? new Date(s.expectedDate) : null,
        notes: s.notes?.trim() || null,
        updatedAt: new Date(),
      })
      .returning();
    created++;
    const its = (Array.isArray(s.items) ? s.items : [])
      .filter((it) => (it?.sku ?? '').trim() || (it?.name ?? '').trim())
      .slice(0, 200)
      .map((it) => ({
        inboundId: head!.id,
        sku: it.sku?.trim() || null,
        name: it.name?.trim() || null,
        expectedQty: Number(it.expectedQty) || 0,
        receivedQty: 0,
      }));
    if (its.length) {
      await db.insert(inboundItems).values(its);
      itemsCreated += its.length;
    }
  }

  await recordPortalAudit('portal.inbound.import', scope, { created, itemsCreated, skipped });
  return c.json({ data: { created, itemsCreated, skipped } }, 201);
});

export default app;

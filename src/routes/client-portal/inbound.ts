// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { inventory } from '../../db/schema/inventory';
import { inboundShipments, inboundItems } from '../../db/schema/inbound';
import { applyMovement } from '../../services/inventory';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { toPortalInboundDto } from '../../lib/client-portal/dto';
import { listPortalInboundReceipts } from '../../lib/client-portal/read-models/inbound-receipts';
import {
  parseDate,
  parsePage,
  parsePageSize,
  parsePositiveInt,
  requestedClientId,
  requestedStoreId,
  scopeOrResponse,
} from '../../lib/client-portal/query-params';

const app = new Hono();

// ── Inbound (receiving) shipments ──────────────────────────────────────────
// Manually-entered POs/ASNs arriving at the warehouse. Read is client-scoped;
// create is admin-only (global or settings:write).
app.get('/inbound/receipts', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'), 50);
  const dateTo = parseDate(c.req.query('dateTo')) ?? new Date();
  const dateFrom = parseDate(c.req.query('dateFrom')) ?? new Date(dateTo.getTime() - 29 * 86_400_000);
  if (dateFrom > dateTo) return c.json({ error: 'dateFrom must not be after dateTo' }, 400);
  const result = await listPortalInboundReceipts(scope, {
    page,
    pageSize,
    clientId: requestedClientId(c),
    storeId: requestedStoreId(c),
    dateFrom,
    dateTo,
  });
  await recordPortalAudit('portal.inbound.receipts.list', scope, {
    page,
    pageSize,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    rows: result.data.length,
  });
  return c.json(result);
});

app.get('/inbound', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const clientId = parsePositiveInt(c.req.query('clientId'));

  const preds: (SQL | undefined)[] = [];
  if (!scope.isGlobal) {
    if (!scope.clientIds.length) return c.json({ data: [] });
    preds.push(inArray(inboundShipments.clientId, scope.clientIds));
  }
  if (clientId != null) {
    if (!scope.isGlobal && !scope.clientIds.includes(clientId)) return c.json({ data: [] });
    preds.push(eq(inboundShipments.clientId, clientId));
  }
  const where = preds.length ? and(...preds) : undefined;

  const heads = await db
    .select({
      shipment: inboundShipments,
      clientName: clients.name,
    })
    .from(inboundShipments)
    .leftJoin(clients, eq(clients.id, inboundShipments.clientId))
    .where(where)
    .orderBy(desc(inboundShipments.createdAt), desc(inboundShipments.id))
    .limit(200);

  const ids = heads.map((h) => h.shipment.id);
  const items = ids.length
    ? await db.select().from(inboundItems).where(inArray(inboundItems.inboundId, ids))
    : [];
  const byInbound = new Map<number, typeof items>();
  for (const it of items) {
    const list = byInbound.get(it.inboundId) ?? [];
    list.push(it);
    byInbound.set(it.inboundId, list);
  }

  await recordPortalAudit('portal.inbound.list', scope, { rows: heads.length });
  return c.json({
    data: heads.map((h) => toPortalInboundDto({ ...h.shipment, clientName: h.clientName }, byInbound.get(h.shipment.id) ?? [])),
  });
});

app.post('/inbound', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    clientId?: number;
    reference?: string;
    supplier?: string;
    status?: string;
    carrier?: string;
    trackingNumber?: string;
    expectedDate?: string;
    notes?: string;
    items?: Array<{ sku?: string; name?: string; expectedQty?: number; receivedQty?: number }>;
  };

  const clientId = typeof body.clientId === 'number' ? body.clientId : null;
  if (!scope.isGlobal && clientId != null && !scope.clientIds.includes(clientId)) {
    return c.json({ error: 'Requested client is outside your access scope.' }, 403);
  }
  const status = ['expected', 'in_transit', 'received', 'cancelled'].includes(body.status ?? '')
    ? (body.status as string)
    : 'expected';

  const [head] = await db
    .insert(inboundShipments)
    .values({
      clientId,
      reference: body.reference?.trim() || null,
      supplier: body.supplier?.trim() || null,
      status,
      carrier: body.carrier?.trim() || null,
      trackingNumber: body.trackingNumber?.trim() || null,
      expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
      receivedDate: status === 'received' ? new Date() : null,
      notes: body.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .returning();

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const cleanItems = rawItems
    .filter((it) => (it?.sku ?? '').trim() || (it?.name ?? '').trim())
    .slice(0, 200)
    .map((it) => ({
      inboundId: head!.id,
      sku: it.sku?.trim() || null,
      name: it.name?.trim() || null,
      expectedQty: Number(it.expectedQty) || 0,
      receivedQty: Number(it.receivedQty) || 0,
    }));
  if (cleanItems.length) await db.insert(inboundItems).values(cleanItems);

  await recordPortalAudit('portal.inbound.create', scope, { id: head!.id, clientId, items: cleanItems.length });
  return c.json({ data: { id: head!.id } }, 201);
});

// Receive an inbound shipment: set received quantities, mark received, and
// (optionally) add the received units to inventory via the canonical
// applyMovement('receive') ledger writer. Admin-only.
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

  for (const it of items) {
    await db.update(inboundItems).set({ receivedQty: receivedFor(it) }).where(eq(inboundItems.id, it.id));
  }
  await db
    .update(inboundShipments)
    .set({ status: 'received', receivedDate: new Date(), updatedAt: new Date() })
    .where(eq(inboundShipments.id, id));

  // Optional inventory bump — match each received line to inventory by SKU
  // within the same client; skip (don't fail) when there's no match.
  const bumps: Array<{ sku: string; qty: number; matched: boolean }> = [];
  if (body.addToInventory) {
    for (const it of items) {
      const qty = receivedFor(it);
      if (!it.sku || qty <= 0) continue;
      const [inv] = await db
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
      await applyMovement({
        inventoryId: inv.id,
        type: 'receive',
        qty,
        note: `Inbound ${head.reference ?? `#${head.id}`}`,
        createdBy: scope.email ?? scope.userId,
      });
      bumps.push({ sku: it.sku, qty, matched: true });
    }
  }

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

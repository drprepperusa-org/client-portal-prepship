// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { inventory, inventoryLedger } from '../../db/schema/inventory';
import { recordCriticalPortalAudit, recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { inventoryLedgerScopePredicate, inventoryScopePredicate } from '../../lib/client-portal/predicates';
import { listPortalInventory } from '../../lib/client-portal/read-models/inventory';
import { applyMovements } from '../../services/inventory';
import { parsePage, parsePageSize, parseDate, requestedClientId, requestedStoreId, requestedSearch, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

app.get('/inventory', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const lowStock = ['1', 'true', 'yes'].includes((c.req.query('lowStock') ?? '').toLowerCase());
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const result = await listPortalInventory(scope, {
    page,
    pageSize,
    clientId,
    storeId,
    search,
    lowStock,
  });
  await recordPortalAudit('portal.inventory.list', scope, { page, pageSize, clientId, storeId, search, lowStock });
  return c.json(result);
});

// Inventory movement history (audit trail) — ledger rows scoped to the
// caller's clients. Read-only. Filters: clientId, sku, type, date range.
app.get('/inventory-history', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const sku = c.req.query('sku')?.trim();
  const type = c.req.query('type')?.trim();
  const from = parseDate(c.req.query('from'));
  const to = parseDate(c.req.query('to'));
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const movementClientId = sql`coalesce(${inventoryLedger.clientId}, ${inventory.clientId})`;
  const movementSku = sql`coalesce(${inventoryLedger.sku}, ${inventory.sku})`;
  const movementClock = sql`coalesce(${inventoryLedger.effectiveAt}, ${inventoryLedger.createdAt})`;
  const where = and(
    inventoryLedgerScopePredicate(scope, { clientId, storeId }),
    sku ? ilike(movementSku, `%${sku}%`) : undefined,
    type ? eq(inventoryLedger.type, type) : undefined,
    from ? gte(movementClock, from) : undefined,
    to ? lte(movementClock, to) : undefined,
  );
  const rows = await db
    .select({
      id: inventoryLedger.id,
      sku: movementSku,
      name: inventory.name,
      clientName: clients.name,
      type: inventoryLedger.type,
      qty: inventoryLedger.qty,
      orderId: inventoryLedger.orderId,
      note: inventoryLedger.note,
      source: inventoryLedger.createdBy,
      createdAt: movementClock,
    })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .leftJoin(clients, eq(clients.id, movementClientId))
    .where(where)
    .orderBy(desc(movementClock), desc(inventoryLedger.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.inventory.history', scope, {
    page,
    pageSize,
    clientId,
    storeId,
    sku: sku ?? null,
    type: type ?? null,
  });
  return c.json({
    data: rows.map((r) => ({ ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt })),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

app.post('/inventory/receive', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Inventory receiving access required' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    clientId?: number;
    idempotencyKey?: string;
    reference?: string;
    receivedAt?: string;
    items?: Array<{ inventoryId?: number; qty?: number }>;
  };
  const clientId = Number(body.clientId);
  const receivedAt = new Date(body.receivedAt ?? '');
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return c.json({ error: 'A valid client is required' }, 400);
  }
  if (Number.isNaN(receivedAt.getTime())) {
    return c.json({ error: 'A valid received date is required' }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 200) {
    return c.json({ error: 'Add between 1 and 200 inventory items' }, 400);
  }

  const items = body.items.map((item) => ({
    inventoryId: Number(item.inventoryId),
    qty: Number(item.qty),
  }));
  if (items.some((item) => !Number.isInteger(item.inventoryId) || item.inventoryId <= 0 || !Number.isInteger(item.qty) || item.qty <= 0 || item.qty > 1_000_000)) {
    return c.json({ error: 'Every item needs a valid SKU and a whole-number quantity from 1 to 1,000,000' }, 400);
  }
  const inventoryIds = items.map((item) => item.inventoryId);
  if (new Set(inventoryIds).size !== inventoryIds.length) {
    return c.json({ error: 'Each SKU may appear only once per receive batch' }, 400);
  }

  const visibleItems = await db
    .select({ id: inventory.id })
    .from(inventory)
    .where(and(
      inArray(inventory.id, inventoryIds),
      eq(inventory.clientId, clientId),
      eq(inventory.active, true),
      inventoryScopePredicate(scope, { clientId }),
    ));
  if (visibleItems.length !== inventoryIds.length) {
    return c.json({ error: 'One or more inventory items are outside your client scope' }, 403);
  }

  const reference = body.reference?.trim().slice(0, 200) || undefined;
  const requestIdentity = body.idempotencyKey?.trim() || c.req.header('Idempotency-Key')?.trim();
  if (!requestIdentity || requestIdentity.length > 200) {
    return c.json({ error: 'A valid idempotency key is required' }, 400);
  }
  const totalUnits = items.reduce((sum, item) => sum + item.qty, 0);
  await recordCriticalPortalAudit('portal.inventory.receive.requested', scope, {
    clientId,
    inventoryIds,
    itemCount: items.length,
    totalUnits,
    receivedAt: receivedAt.toISOString(),
    reference: reference ?? null,
  });
  const results = await applyMovements(items.map((item, index) => ({
    inventoryId: item.inventoryId,
    type: 'receive',
    qty: item.qty,
    note: reference,
    createdBy: scope.email ?? scope.userId,
    effectiveAt: receivedAt,
    idempotencyKey: `portal-receive:${requestIdentity}:${index}:${item.inventoryId}`,
    sourceEntity: 'client_portal_receive',
    sourceId: `${requestIdentity}:${index}:${item.inventoryId}`,
  })));
  await recordPortalAudit('portal.inventory.receive.completed', scope, {
    clientId,
    ledgerIds: results.map((result) => result.ledger?.id).filter(Boolean),
    itemCount: results.length,
    totalUnits,
  });
  return c.json({ data: { received: results.length, totalUnits } });
});

export default app;

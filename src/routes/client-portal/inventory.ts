// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { inventory, inventoryLedger } from '../../db/schema/inventory';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { inventoryScopePredicate } from '../../lib/client-portal/predicates';
import { listPortalInventory } from '../../lib/client-portal/read-models/inventory';
import { parsePage, parsePageSize, parseDate, requestedClientId, requestedStoreId, requestedSearch, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

app.get('/inventory', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const lowStock = ['1', 'true', 'yes'].includes((c.req.query('lowStock') ?? '').toLowerCase());
  const result = await listPortalInventory(scope, {
    page,
    pageSize,
    clientId: requestedClientId(c),
    storeId: requestedStoreId(c),
    search,
    lowStock,
  });
  await recordPortalAudit('portal.inventory.list', scope, { page, pageSize, search, lowStock });
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
  const where = and(
    inventoryScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) }),
    sku ? ilike(inventory.sku, `%${sku}%`) : undefined,
    type ? eq(inventoryLedger.type, type) : undefined,
    from ? gte(inventoryLedger.createdAt, from) : undefined,
    to ? lte(inventoryLedger.createdAt, to) : undefined,
  );
  const rows = await db
    .select({
      id: inventoryLedger.id,
      sku: inventory.sku,
      name: inventory.name,
      clientName: clients.name,
      type: inventoryLedger.type,
      qty: inventoryLedger.qty,
      orderId: inventoryLedger.orderId,
      note: inventoryLedger.note,
      source: inventoryLedger.createdBy,
      createdAt: inventoryLedger.createdAt,
    })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .leftJoin(clients, eq(clients.id, inventory.clientId))
    .where(where)
    .orderBy(desc(inventoryLedger.createdAt), desc(inventoryLedger.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.inventory.history', scope, { page, pageSize, sku: sku ?? null, type: type ?? null });
  return c.json({
    data: rows.map((r) => ({ ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt })),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

export default app;

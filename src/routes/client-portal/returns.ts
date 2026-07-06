// Client-portal sub-router — CP-029 Returns section + create-return flow.
// Mounted at '/' by the thin aggregator (src/routes/client-portal.ts), so these
// relative paths keep their /api/client-portal/* surface.
//
// This is the UI + API layer over the already-built returns backend:
//   • CP-026 schema  — src/db/schema/returns.ts (returns / return_items /
//                      return_inspections / return_inspection_media)
//   • CP-027 service — src/services/returns.ts        (createReturnLabel)
//   • CP-028 service — src/services/return-delivery.ts (resolveReturnDelivery /
//                      deliverReturn)
//
// SAFETY / REDACTION CONTRACT (mirrors the CP-027/028 client-safe results):
// every DTO this router returns is CARRIER/SERVICE/PROVIDER-FREE. A client
// return row/detail NEVER carries carrierCode / serviceCode / carrierProvider /
// providerAccountId / selectedRateJson — clients track returns by number and
// status, not by carrier. The label/tracking/cost SOT stays on shipments; the
// return label PDF is served through the existing /labels/mock/:id route (the
// return shipment's labelUrl already points at it) — we never invent a new one.
import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client';
import { getReturnMediaSignedUrl, uploadReturnInspectionMedia } from '../../lib/supabase';
import { clients } from '../../db/schema/clients';
import { orders } from '../../db/schema/orders';
import { orderItems } from '../../db/schema/order-items';
import { shipments } from '../../db/schema/shipments';
import { locations } from '../../db/schema/locations';
import {
  returns,
  returnItems,
  returnInspections,
  returnInspectionMedia,
  type Return,
  type ReturnItem,
} from '../../db/schema/returns';
import { createReturnLabel, resolveReturnCustomerPrice } from '../../services/returns';
import { deliverReturn } from '../../services/return-delivery';
import { trackingUrlForCarrier } from '../../lib/tracking-url';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope, type ClientPortalScope } from '../../lib/client-portal/scope';
import { intArrayLiteral, orderScopePredicate } from '../../lib/client-portal/predicates';
import {
  parsePage,
  parsePageSize,
  parsePositiveInt,
  requestedClientId,
  requestedSearch,
  requestedStoreId,
  scopeOrResponse,
} from '../../lib/client-portal/query-params';

const app = new Hono();

// The lifecycle statuses a return row can carry (CP-026). Used to validate the
// ?status= list filter without letting an arbitrary string reach SQL.
const RETURN_STATUS_FILTERS = new Set([
  'requested',
  'label_created',
  'in_transit',
  'received',
  'inspected',
  'closed',
  'cancelled',
]);

// CP-030 — the statuses a return can be in when the 3PL is still expecting or
// actively receiving it. The mobile receiving list is bounded to these.
const RECEIVING_STATUSES = ['requested', 'label_created', 'in_transit', 'received'];

// CP-030 — the agreed inspection CONDITION enum. An inspection write must carry
// one of these (or none, for a bare "received" ack); anything else is rejected.
const INSPECTION_CONDITIONS = new Set([
  'sealed_new',
  'opened_good',
  'damaged',
  'missing_item',
  'wrong_item',
  'other',
]);

// CP-030 — inspection media kinds. Photo or video only.
const INSPECTION_MEDIA_TYPES = new Set(['photo', 'video']);

// CP-030 — 3PL/admin-only WRITE gate. Reused verbatim from the sibling
// operator-only writes (src/routes/client-portal/inbound.ts): a scoped client
// user is NOT global and lacks 'settings:write', so they get a 403. This is the
// single source of truth for "can this caller record receiving/inspection".
function operatorGateOrResponse(c: Context, scope: ClientPortalScope): Response | null {
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return null;
}

// ── Scope predicate for returns ──────────────────────────────────────────────
// A return is visible when the caller can see its ORDER. We reuse the canonical
// order-scope predicate against a correlated EXISTS on orders, so returns stay
// bounded to exactly the client/store scope of the caller's JWT — the identical
// guardrail every sibling read uses. Restricted callers with no scope resolve to
// `false` (see orderScopePredicate).
function returnScopePredicate(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null } = {},
): SQL {
  const scopedPredicates: SQL[] = [];
  if (scope.isRestricted) {
    if (scope.clientIds.length) {
      scopedPredicates.push(sql`scoped_order.client_id = any(${intArrayLiteral(scope.clientIds)})`);
    }
    if (scope.storeIds.length) {
      scopedPredicates.push(sql`scoped_order.store_id = any(${intArrayLiteral(scope.storeIds)})`);
    }
  }
  const scopePredicate = !scope.isRestricted
    ? undefined
    : scopedPredicates.length === 0
      ? sql`false`
      : scopedPredicates.length === 1
        ? scopedPredicates[0]
        : (or(...scopedPredicates) ?? sql`false`);
  const orderPredicate = and(
    scopePredicate,
    filters.clientId ? sql`scoped_order.client_id = ${filters.clientId}` : undefined,
    filters.storeId ? sql`scoped_order.store_id = ${filters.storeId}` : undefined,
  );
  return sql`exists (
    select 1 from ${orders} scoped_order
    where scoped_order.id = ${returns.orderId}
      ${orderPredicate ? sql`and (${orderPredicate})` : sql``}
  )`;
}

function returnSearchPredicate(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${search}%`;
  return or(
    ilike(orders.orderNumber, pattern),
    ilike(orders.externalOrderId, pattern),
    ilike(returns.reason, pattern),
    ilike(shipments.trackingNumber, pattern),
    ilike(shipments.labelTracking, pattern),
    sql`${returns.id}::text ilike ${pattern}`,
  );
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Client-safe return LIST row. Deliberately CARRIER/SERVICE/PROVIDER-FREE:
 * exposes order identity, lifecycle status, delivery method/status, tracking,
 * PDF availability, and (financially gated) price — never carrierCode /
 * serviceCode / carrierProvider / providerAccountId / selectedRate. Price comes
 * from the canonical return shipment cost only when the caller can view money.
 */
async function toClientSafeReturnRow(
  row: {
    ret: Return;
    orderNumber: string | null;
    clientName: string | null;
    returnTracking: string | null;
    // CP-034: the return shipment's canonical carrier (labelCarrier) — used ONLY
    // to build the official tracking URL below, never surfaced in the DTO.
    returnCarrier: string | null;
    returnLabelUrl: string | null;
    returnCost: string | null;
  },
  options: { includeFinancials: boolean },
) {
  return {
    id: row.ret.id,
    orderId: row.ret.orderId,
    orderNumber: row.orderNumber,
    clientId: row.ret.clientId,
    clientName: row.clientName,
    status: row.ret.status,
    initiatedBy: row.ret.initiatedBy,
    reason: row.ret.reason,
    deliveryMethod: row.ret.deliveryMethod,
    deliveryStatus: row.ret.deliveryStatus,
    trackingNumber: row.returnTracking,
    // CP-034: a backend-built OFFICIAL carrier tracking URL (USPS/UPS/FedEx)
    // from the canonical return-shipment carrier — never 17track, and never the
    // carrier identity itself. '' (unknown carrier) → null (no external link).
    trackingUrl: trackingUrlForCarrier(row.returnCarrier, row.returnTracking) || null,
    // Availability booleans only — never the raw provider URL in the LIST DTO.
    pdfAvailable: Boolean(row.returnLabelUrl),
    // CP-032: the client-facing price is the SAME billing-policy amount billing
    // charges (resolveReturnCustomerPrice), NEVER the raw house/label cost. Null
    // until priced (no return-shipment cost yet) or for non-financial callers.
    price:
      options.includeFinancials && row.returnCost != null
        ? await resolveReturnCustomerPrice(Number(row.returnCost), row.ret.clientId)
        : null,
    createdAt: iso(row.ret.createdAt),
  };
}

// ── GET /returns — client-safe list for the caller's scope ───────────────────
app.get('/returns', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const search = requestedSearch(c);
  const statusParam = c.req.query('status');
  const status = statusParam && RETURN_STATUS_FILTERS.has(statusParam) ? statusParam : undefined;
  const orderId = parsePositiveInt(c.req.query('orderId'));

  const where = and(
    returnScopePredicate(scope, { clientId, storeId }),
    status ? eq(returns.status, status) : undefined,
    orderId ? eq(returns.orderId, orderId) : undefined,
    returnSearchPredicate(search),
  );

  // Left-join the canonical return shipment (shipments.isReturn) for tracking /
  // PDF availability / cost — the label truth lives there, never on returns.
  const rows = await db
    .select({
      ret: returns,
      orderNumber: orders.orderNumber,
      clientName: clients.name,
      returnTracking: sql<string | null>`coalesce(${shipments.labelTracking}, ${shipments.trackingNumber})`,
      // CP-034: canonical return-shipment carrier for the official tracking URL.
      returnCarrier: shipments.labelCarrier,
      returnLabelUrl: shipments.labelUrl,
      returnCost: sql<string | null>`coalesce(${shipments.labelCost}, ${shipments.cost})::text`,
    })
    .from(returns)
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .leftJoin(clients, eq(clients.id, returns.clientId))
    .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
    .where(where)
    .orderBy(desc(returns.createdAt), desc(returns.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(returns)
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;

  await recordPortalAudit('portal.returns.list', scope, { page, pageSize, status: status ?? null, clientId, search });
  return c.json({
    data: await Promise.all(
      rows.map((row) => toClientSafeReturnRow(row, { includeFinancials: scope.canViewFinancials })),
    ),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

// ── GET /returns/locations — selectable return-to locations for the create form ──
// CP-029: the create-return modal renders this to let the user CHOOSE a
// return-to location (with the configured default surfaced first). The payload
// is non-sensitive operator-managed metadata only — id / name / city / state /
// isDefault — never carrier, rate, or cost. The backend still validates the
// chosen id and applies the default when the caller omits it (POST /returns).
// Any in-scope portal caller may read it (a numeric :id can't match 'locations',
// so this never shadows the detail route below).
app.get('/returns/locations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      city: locations.city,
      state: locations.state,
      isDefault: locations.isDefault,
    })
    .from(locations)
    .where(eq(locations.active, true))
    .orderBy(desc(locations.isDefault), locations.name);
  return c.json({ data: rows });
});

// ── GET /returns/:id — client-safe detail (items, tracking, delivery, PDF, inspection) ──
app.get('/returns/:id{[0-9]+}', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));

  const [row] = await db
    .select({
      ret: returns,
      orderNumber: orders.orderNumber,
      clientName: clients.name,
      returnTracking: sql<string | null>`coalesce(${shipments.labelTracking}, ${shipments.trackingNumber})`,
      returnTrackingStatus: shipments.trackingStatus,
      // CP-034: canonical return-shipment carrier for the official tracking URL.
      returnCarrier: shipments.labelCarrier,
      returnLabelUrl: shipments.labelUrl,
      returnCost: sql<string | null>`coalesce(${shipments.labelCost}, ${shipments.cost})::text`,
    })
    .from(returns)
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .leftJoin(clients, eq(clients.id, returns.clientId))
    .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
    .where(and(eq(returns.id, id), returnScopePredicate(scope)))
    .limit(1);
  if (!row) return c.json({ error: 'Return not found' }, 404);

  const items = await db
    .select()
    .from(returnItems)
    .where(eq(returnItems.returnId, id))
    .orderBy(returnItems.id);

  // Inspection notes/media — the 3PL receiving detail, when present.
  const inspections = await db
    .select()
    .from(returnInspections)
    .where(eq(returnInspections.returnId, id))
    .orderBy(desc(returnInspections.id));
  const inspectionIds = inspections.map((i) => i.id);
  const media = inspectionIds.length
    ? await db.select().from(returnInspectionMedia).where(inArray(returnInspectionMedia.inspectionId, inspectionIds))
    : [];
  const mediaByInspection = new Map<number, typeof media>();
  for (const m of media) {
    const list = mediaByInspection.get(m.inspectionId) ?? [];
    list.push(m);
    mediaByInspection.set(m.inspectionId, list);
  }
  // CP-030: resolve each stored object path to a short-lived SIGNED URL (the
  // media bucket is private — a raw path or blob: URL is never returned to the
  // client). Legacy absolute URLs pass through unchanged; a null (missing or
  // renamed object) degrades to a "media unavailable" state, not a broken link.
  const mediaUrlById = new Map<number, string | null>();
  await Promise.all(
    media.map(async (m) => {
      mediaUrlById.set(m.id, await getReturnMediaSignedUrl(m.storageRef));
    }),
  );

  const includeFinancials = scope.canViewFinancials;
  const safeRow = await toClientSafeReturnRow(
    {
      ret: row.ret,
      orderNumber: row.orderNumber,
      clientName: row.clientName,
      returnTracking: row.returnTracking,
      returnCarrier: row.returnCarrier,
      returnLabelUrl: row.returnLabelUrl,
      returnCost: row.returnCost,
    },
    { includeFinancials },
  );
  await recordPortalAudit('portal.returns.detail.view', scope, { returnId: id });
  return c.json({
    data: {
      ...safeRow,
      // CP-033: `status` above is the canonical, backend-owned return lifecycle.
      // `trackingStatus` here is the return shipment's carrier tracking state —
      // a DISTINCT, tracking-only signal that must NEVER be used to infer the
      // lifecycle status (warehouse receiving owns received/inspected).
      trackingStatus: row.returnTrackingStatus ?? null,
      deliveryError: row.ret.deliveryError,
      returnToLocationId: row.ret.returnToLocationId,
      // The PDF is served by the EXISTING /labels/... route the return
      // shipment's labelUrl already points at — surfaced here as pdfUrl so the
      // client can download it (manual_pdf delivery). Never a new mechanism.
      pdfUrl: row.returnLabelUrl ?? null,
      requestedAt: iso(row.ret.requestedAt),
      closedAt: iso(row.ret.closedAt),
      items: items.map((it: ReturnItem) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        quantity: Number(it.quantity),
        orderItemId: it.orderItemId,
      })),
      inspections: inspections.map((ins) => ({
        id: ins.id,
        status: ins.status,
        condition: ins.condition,
        comments: ins.comments,
        receivedAt: iso(ins.receivedAt),
        media: (mediaByInspection.get(ins.id) ?? []).map((m) => ({
          id: m.id,
          mediaType: m.mediaType,
          // Short-lived signed URL (private bucket) — never the raw object path.
          url: mediaUrlById.get(m.id) ?? null,
          contentType: m.contentType,
          capturedAt: iso(m.capturedAt),
        })),
      })),
    },
  });
});

// ── POST /returns — create a return + return_items ───────────────────────────
// Validates the caller's scope OWNS the order, records who initiated it (client
// vs three_pl derived from the caller role), a selectable return-to location
// (default when omitted), and partial quantities ≤ ordered. The one-active-per-
// order rule is enforced by the DB partial unique index (and the CP-027 service)
// — we surface a clean 409 instead of a raw constraint error.
app.post('/returns', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;

  const body = (await c.req.json().catch(() => ({}))) as {
    orderId?: number;
    reason?: string;
    returnToLocationId?: number;
    items?: Array<{ sku?: string; name?: string; quantity?: number; orderItemId?: number }>;
  };

  const orderId = typeof body.orderId === 'number' ? body.orderId : null;
  if (orderId == null) return c.json({ error: 'orderId is required' }, 400);

  // Scope-ownership: the caller may only start a return for an order inside their
  // client/store scope. Re-check the order against the SAME order-scope predicate
  // every other read uses, so a client can never create a return for an order
  // they cannot see.
  const [order] = await db
    .select({ id: orders.id, clientId: orders.clientId, storeId: orders.storeId, orderStatus: orders.orderStatus })
    .from(orders)
    .where(and(eq(orders.id, orderId), orderScopePredicate(scope) ?? sql`true`))
    .limit(1);
  if (!order) return c.json({ error: 'Order not found or outside your access scope' }, 404);

  // Resolve the client id for the returns row from the order's own client (or,
  // when the order is store-only, the client that owns the store).
  let clientId = order.clientId ?? null;
  if (clientId == null && order.storeId != null) {
    const [match] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(sql`${clients.storeIds} @> ${[order.storeId]}::integer[]`)
      .limit(1);
    clientId = match?.id ?? null;
  }

  // initiatedBy: a global operator/admin acts as the 3PL; a scoped client user
  // acts as the client. Matches the CP-026 'client' | 'three_pl' contract.
  const initiatedBy = scope.isGlobal ? 'three_pl' : 'client';

  // Return-to location: selectable, defaulting to the configured default
  // location when omitted. Validate the id exists + is active when supplied.
  let returnToLocationId = typeof body.returnToLocationId === 'number' ? body.returnToLocationId : null;
  if (returnToLocationId != null) {
    const [loc] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, returnToLocationId), eq(locations.active, true)))
      .limit(1);
    if (!loc) return c.json({ error: 'Return-to location not found' }, 400);
  } else {
    const [def] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.isDefault, true), eq(locations.active, true)))
      .limit(1);
    returnToLocationId = def?.id ?? null;
  }

  // Partial quantities: validate each requested item ≤ the ordered quantity for
  // that SKU on this order (from the canonical order_items). Rows with no
  // positive quantity are dropped; an all-empty payload is rejected.
  const orderedRows = await db
    .select({ id: orderItems.id, sku: orderItems.sku, name: orderItems.name, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const orderedBySku = new Map<string, { qty: number; id: number; name: string | null }>();
  // CP-032: also index by orderItemId so a supplied id can be validated against
  // THIS order + its SKU (never trust an arbitrary / foreign orderItemId).
  const orderedById = new Map<number, { sku: string; qty: number }>();
  for (const r of orderedRows) {
    orderedBySku.set(r.sku.toLowerCase(), { qty: Number(r.quantity) || 0, id: r.id, name: r.name });
    orderedById.set(r.id, { sku: r.sku, qty: Number(r.quantity) || 0 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const cleanItems: Array<{ sku: string; name: string | null; quantity: number; orderItemId: number | null }> = [];
  for (const it of rawItems.slice(0, 200)) {
    const sku = (it?.sku ?? '').trim();
    const quantity = Number(it?.quantity) || 0;
    if (!sku || quantity <= 0) continue;
    const ordered = orderedBySku.get(sku.toLowerCase());
    if (ordered && quantity > ordered.qty) {
      return c.json({ error: `Return quantity for ${sku} (${quantity}) exceeds the ordered quantity (${ordered.qty})` }, 400);
    }
    // CP-032: a supplied orderItemId MUST belong to this order AND match the
    // submitted SKU — reject a mismatched / foreign id rather than silently
    // trusting it. When omitted, resolve the id from the ordered SKU.
    let orderItemId: number | null;
    if (typeof it?.orderItemId === 'number') {
      const owned = orderedById.get(it.orderItemId);
      if (!owned || owned.sku.toLowerCase() !== sku.toLowerCase()) {
        return c.json(
          { error: `orderItemId ${it.orderItemId} does not belong to this order or does not match SKU ${sku}` },
          400,
        );
      }
      orderItemId = it.orderItemId;
    } else {
      orderItemId = ordered?.id ?? null;
    }
    cleanItems.push({
      sku,
      name: (it?.name ?? ordered?.name ?? '').trim() || null,
      quantity,
      orderItemId,
    });
  }
  if (!cleanItems.length) return c.json({ error: 'At least one returned item with a positive quantity is required' }, 400);

  // Insert the workflow row. The DB partial unique index
  // (returns_one_active_per_order_idx) blocks a second active, non-override
  // return for the same order — surface that as a clean 409, not a 500.
  let created: Return;
  try {
    const [row] = await db
      .insert(returns)
      .values({
        orderId,
        clientId,
        returnToLocationId,
        status: 'requested',
        initiatedBy,
        initiatedByEmail: scope.email ?? null,
        reason: body.reason?.trim() || null,
      })
      .returning();
    created = row!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/returns_one_active_per_order_idx|unique/i.test(message)) {
      return c.json({ error: 'An active return already exists for this order.' }, 409);
    }
    console.error('[returns] create failed:', message);
    return c.json({ error: 'Could not create the return' }, 500);
  }

  if (cleanItems.length) {
    await db.insert(returnItems).values(
      cleanItems.map((it) => ({
        returnId: created.id,
        orderId,
        orderItemId: it.orderItemId,
        sku: it.sku,
        name: it.name,
        quantity: String(it.quantity),
      })),
    );
  }

  await recordPortalAudit('portal.returns.create', scope, { returnId: created.id, orderId, items: cleanItems.length, initiatedBy });
  return c.json({ data: { id: created.id, status: created.status } }, 201);
});

// ── POST /returns/:id/label — create the return label (CP-027 service) ───────
// Delegates to createReturnLabel, which owns rate-shopping/purchase (or the
// offline mock) and returns a CLIENT-SAFE result (price / tracking / status /
// PDF availability — never carrier/service/provider). We only pass identifiers
// and surface the service's redacted result verbatim.
app.post('/returns/:id{[0-9]+}/label', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));

  const [ret] = await db
    .select({ id: returns.id, orderId: returns.orderId, reason: returns.reason })
    .from(returns)
    .where(and(eq(returns.id, id), returnScopePredicate(scope)))
    .limit(1);
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  try {
    const result = await createReturnLabel({
      returnId: ret.id,
      orderId: ret.orderId,
      reason: ret.reason ?? undefined,
      actorEmail: scope.email,
    });
    await recordPortalAudit('portal.returns.label.create', scope, { returnId: id });
    return c.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create return label';
    // The CP-027 service throws with a details.returnShipmentId when an active
    // return already exists — surface a clean 409.
    const isDuplicate = /active return already exists/i.test(message);
    return c.json({ error: message }, isDuplicate ? 409 : 500);
  }
});

// ── POST /returns/:id/deliver — resolve + deliver the label (CP-028 service) ──
// Delegates to deliverReturn, which decides manual_pdf vs shopify_native (flag +
// capability gated) and returns a CLIENT-SAFE delivery result. The return label
// PDF stays downloadable via the existing /labels/... route regardless.
app.post('/returns/:id{[0-9]+}/deliver', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));

  const [ret] = await db
    .select()
    .from(returns)
    .where(and(eq(returns.id, id), returnScopePredicate(scope)))
    .limit(1);
  if (!ret) return c.json({ error: 'Return not found' }, 404);
  if (ret.returnShipmentId == null) {
    return c.json({ error: 'Create the return label before delivering it.' }, 400);
  }

  const [returnShipment] = await db.select().from(shipments).where(eq(shipments.id, ret.returnShipmentId)).limit(1);
  if (!returnShipment) return c.json({ error: 'Return shipment not found' }, 404);
  const [order] = await db.select().from(orders).where(eq(orders.id, ret.orderId)).limit(1);
  if (!order) return c.json({ error: 'Order not found' }, 404);

  const result = await deliverReturn({ returnRow: ret, returnShipment, order });
  await recordPortalAudit('portal.returns.deliver', scope, { returnId: id, method: result.deliveryMethod, status: result.deliveryStatus });
  return c.json({ data: result });
});

// ── GET /returns/receiving — 3PL/admin receiving queue (mobile-oriented) ─────
// A small, scannable list of the returns the warehouse is still expecting or
// actively receiving (requested | label_created | in_transit | received),
// searchable by return tracking / order number / return id. Operator-only (a
// client user has no receiving desk) AND bounded by the SAME return-scope
// predicate every other read uses, so an operator with a restricted JWT still
// only sees their scope. The payload is deliberately minimal for a phone.
app.get('/returns/receiving', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const gated = operatorGateOrResponse(c, scope);
  if (gated) return gated;

  const search = requestedSearch(c);
  const where = and(
    returnScopePredicate(scope),
    inArray(returns.status, RECEIVING_STATUSES),
    returnSearchPredicate(search),
  );

  const rows = await db
    .select({
      ret: returns,
      orderNumber: orders.orderNumber,
      clientName: clients.name,
      returnTracking: sql<string | null>`coalesce(${shipments.labelTracking}, ${shipments.trackingNumber})`,
      returnToLocationName: locations.name,
    })
    .from(returns)
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .leftJoin(clients, eq(clients.id, returns.clientId))
    .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
    .leftJoin(locations, eq(locations.id, returns.returnToLocationId))
    .where(where)
    .orderBy(desc(returns.requestedAt), desc(returns.id))
    .limit(100);

  await recordPortalAudit('portal.returns.receiving.list', scope, { rows: rows.length, search });
  return c.json({
    data: rows.map((row) => ({
      id: row.ret.id,
      orderId: row.ret.orderId,
      orderNumber: row.orderNumber,
      clientName: row.clientName,
      status: row.ret.status,
      trackingNumber: row.returnTracking,
      returnToLocation: row.returnToLocationName,
      requestedAt: iso(row.ret.requestedAt),
    })),
  });
});

// ── POST /returns/:id/inspection — record 3PL receiving/inspection ───────────
// 3PL/admin WRITE only (a client user is 403'd by the operator gate). Upserts
// the return_inspections row for this return: receivedAt, condition (validated
// against INSPECTION_CONDITIONS), status, comments; stamps inspectorEmail from
// the caller and links returnShipmentId from the return. Advances the return's
// lifecycle → 'received' (bare ack) or 'inspected' (a condition was recorded).
// Scope is re-validated: an operator can only inspect a return inside their JWT
// scope, exactly like every other return read/write here.
app.post('/returns/:id{[0-9]+}/inspection', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const gated = operatorGateOrResponse(c, scope);
  if (gated) return gated;
  const id = Number(c.req.param('id'));

  const [ret] = await db
    .select({ id: returns.id, returnShipmentId: returns.returnShipmentId })
    .from(returns)
    .where(and(eq(returns.id, id), returnScopePredicate(scope)))
    .limit(1);
  if (!ret) return c.json({ error: 'Return not found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    receivedAt?: string;
    condition?: string;
    status?: string;
    comments?: string;
  };

  const condition = typeof body.condition === 'string' && body.condition.trim() ? body.condition.trim() : null;
  if (condition && !INSPECTION_CONDITIONS.has(condition)) {
    return c.json({ error: `Invalid condition. Expected one of: ${[...INSPECTION_CONDITIONS].join(', ')}` }, 400);
  }
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime())) return c.json({ error: 'Invalid receivedAt' }, 400);
  const comments = typeof body.comments === 'string' && body.comments.trim() ? body.comments.trim().slice(0, 2000) : null;
  // The inspection status: 'passed' for a good/sealed condition, 'failed' for a
  // damaged/missing/wrong one, otherwise 'pending'. Callers may override with an
  // explicit status; anything else falls back to the derived value.
  const derivedStatus =
    condition === 'sealed_new' || condition === 'opened_good'
      ? 'passed'
      : condition === 'damaged' || condition === 'missing_item' || condition === 'wrong_item'
        ? 'failed'
        : 'pending';
  const status = ['pending', 'passed', 'failed'].includes(body.status ?? '') ? (body.status as string) : derivedStatus;

  // Upsert: one inspection row per return (the latest ack). Update the existing
  // row when present, else insert a fresh one.
  const [existing] = await db
    .select({ id: returnInspections.id })
    .from(returnInspections)
    .where(eq(returnInspections.returnId, id))
    .orderBy(desc(returnInspections.id))
    .limit(1);

  let inspectionId: number;
  if (existing) {
    await db
      .update(returnInspections)
      .set({
        returnShipmentId: ret.returnShipmentId,
        receivedAt,
        condition,
        status,
        comments,
        inspectorEmail: scope.email ?? null,
        updatedAt: new Date(),
      })
      .where(eq(returnInspections.id, existing.id));
    inspectionId = existing.id;
  } else {
    const [inserted] = await db
      .insert(returnInspections)
      .values({
        returnId: id,
        returnShipmentId: ret.returnShipmentId,
        receivedAt,
        condition,
        status,
        comments,
        inspectorEmail: scope.email ?? null,
      })
      .returning({ id: returnInspections.id });
    inspectionId = inserted!.id;
  }

  // Advance the return lifecycle: 'inspected' once a condition is recorded,
  // otherwise 'received'. Never regress a return that is already closed/cancelled.
  const nextReturnStatus = condition ? 'inspected' : 'received';
  await db
    .update(returns)
    .set({ status: nextReturnStatus, updatedAt: new Date() })
    .where(and(eq(returns.id, id), sql`${returns.status} not in ('closed', 'cancelled')`));

  await recordPortalAudit('portal.returns.inspection.record', scope, {
    returnId: id,
    inspectionId,
    condition,
    status,
    returnStatus: nextReturnStatus,
  });
  return c.json({ data: { id: inspectionId, returnId: id, status, condition, returnStatus: nextReturnStatus } }, existing ? 200 : 201);
});

// ── POST /returns/:id/inspection/:iid/media — upload inspection media ────────
// 3PL/admin WRITE only. Accepts a multipart/form-data upload (the operator's
// phone posts the captured photo/video itself) and RELAYS the binary to the
// private Supabase Storage bucket via the service client — the browser never
// holds the service key. The DB persists only the durable object PATH as
// storageRef; the detail endpoint serves it back through short-lived signed
// URLs. No blob: preview URL is ever persisted, and if the upload fails we
// surface an error and insert NOTHING (no dead reference).
//
// Form fields: `file` (required), `mediaType` ('photo'|'video', required),
// `capturedAt` (optional ISO). Validated the same way, and gated by the SAME
// operator + scope checks as the inspection write.
const MEDIA_MAX_BYTES = 25 * 1024 * 1024; // 25 MB — a phone photo or short clip.
app.post('/returns/:id{[0-9]+}/inspection/:iid{[0-9]+}/media', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const gated = operatorGateOrResponse(c, scope);
  if (gated) return gated;
  const id = Number(c.req.param('id'));
  const iid = Number(c.req.param('iid'));

  // The inspection must belong to this return AND the return must be in scope.
  const [match] = await db
    .select({ inspectionId: returnInspections.id })
    .from(returnInspections)
    .innerJoin(returns, eq(returns.id, returnInspections.returnId))
    .where(and(eq(returnInspections.id, iid), eq(returnInspections.returnId, id), returnScopePredicate(scope)))
    .limit(1);
  if (!match) return c.json({ error: 'Inspection not found' }, 404);

  // Reject an over-large upload from the declared Content-Length BEFORE buffering
  // the body (formData() reads the whole request into memory). Multipart overhead
  // makes this an upper bound on the file, so it never false-rejects a legit file.
  const declaredLen = Number(c.req.header('content-length') ?? 0);
  if (declaredLen > MEDIA_MAX_BYTES) {
    return c.json({ error: 'File exceeds the 25 MB limit' }, 413);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'Expected multipart/form-data with a file field' }, 400);
  }

  const mediaType = String(form.get('mediaType') ?? '').trim();
  if (!INSPECTION_MEDIA_TYPES.has(mediaType)) {
    return c.json({ error: "mediaType must be 'photo' or 'video'" }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return c.json({ error: 'A non-empty file field is required' }, 400);
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return c.json({ error: 'File exceeds the 25 MB limit' }, 413);
  }
  const capturedRaw = form.get('capturedAt');
  const capturedAt = typeof capturedRaw === 'string' && capturedRaw ? new Date(capturedRaw) : new Date();
  if (Number.isNaN(capturedAt.getTime())) return c.json({ error: 'Invalid capturedAt' }, 400);

  const contentType = (file.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg')).slice(0, 200);
  const safeName = (file.name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  // Durable, scannable, collision-free object path — never carrier/provider data.
  const objectPath = `returns/${id}/inspection/${iid}/${randomUUID()}-${safeName}`;

  // Upload FIRST; only persist the row if the binary durably landed. A failed
  // upload throws → we surface a clean 502 and store no dead storageRef.
  try {
    await uploadReturnInspectionMedia(objectPath, await file.arrayBuffer(), contentType);
  } catch (err) {
    console.error('[returns] inspection media upload failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Media upload failed. Please retry.' }, 502);
  }

  const [inserted] = await db
    .insert(returnInspectionMedia)
    .values({
      inspectionId: iid,
      mediaType,
      storageRef: objectPath,
      contentType,
      sizeBytes: file.size,
      capturedAt,
    })
    .returning({ id: returnInspectionMedia.id });

  await recordPortalAudit('portal.returns.inspection.media.add', scope, {
    returnId: id,
    inspectionId: iid,
    mediaId: inserted!.id,
    mediaType,
  });
  return c.json({ data: { id: inserted!.id, inspectionId: iid, mediaType } }, 201);
});

export default app;

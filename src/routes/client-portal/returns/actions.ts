import type { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderItems } from '../../../db/schema/order-items';
import { orders } from '../../../db/schema/orders';
import { returnItems, returns, type Return } from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { orderScopePredicate } from '../../../lib/client-portal/predicates';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { deliverReturn } from '../../../services/return-delivery';
import { recordReturnActivity } from '../../../services/return-activity';
import {
  createReturnLabel,
  ReturnLabelPurchasePendingError,
  ReturnLabelRateUnavailableError,
  ReturnLabelStateError,
  ReturnCustomerRateUnavailableError,
} from '../../../services/returns';
import {
  RETURN_LABEL_ASSIGNMENT_CONFLICT_CODE,
  ReturnLabelAssignmentConflictError,
} from '../../../services/return-label-slot';
import { registerReturnBillingDateRoute } from './billing-date';
import {
  registerReturnExternalLabelPdfRoute,
  registerReturnExternalTrackingRoute,
} from './external-label';
import { buildReturnReference, returnScopePredicate } from './shared';

const DEFAULT_RETURN_RECIPIENT_NAME = 'DR PREPPER LLC';

function returnRecipientNameFromOrder(raw: unknown, clientName: string | null): string {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const shipFrom = record.shipFrom && typeof record.shipFrom === 'object' && !Array.isArray(record.shipFrom)
    ? record.shipFrom as Record<string, unknown>
    : {};
  for (const value of [shipFrom.name, shipFrom.company, clientName]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return DEFAULT_RETURN_RECIPIENT_NAME;
}

function registerReturnCreateRoute(app: Hono): void {
  app.post('/returns', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;

    const body = (await c.req.json().catch(() => ({}))) as {
      orderId?: number;
      reason?: string;
      returnRecipientName?: string;
      items?: Array<{ sku?: string; name?: string; quantity?: number; orderItemId?: number }>;
    };
    const orderId = typeof body.orderId === 'number' ? body.orderId : null;
    if (orderId == null) return c.json({ error: 'orderId is required' }, 400);

    const [order] = await db
      .select({
        id: orders.id,
        clientId: orders.clientId,
        storeId: orders.storeId,
        orderStatus: orders.orderStatus,
        orderNumber: orders.orderNumber,
        raw: orders.raw,
        clientName: clients.name,
      })
      .from(orders)
      .leftJoin(clients, eq(clients.id, orders.clientId))
      .where(and(eq(orders.id, orderId), orderScopePredicate(scope) ?? sql`true`))
      .limit(1);
    if (!order) return c.json({ error: 'Order not found or outside your access scope' }, 404);

    let clientId = order.clientId ?? null;
    let clientName = order.clientName ?? null;
    if (clientId == null && order.storeId != null) {
      const [match] = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(sql`${clients.storeIds} @> ${[order.storeId]}::integer[]`)
        .limit(1);
      clientId = match?.id ?? null;
      clientName = match?.name ?? clientName;
    }

    const requestedRecipientName = body.returnRecipientName?.trim();
    if (body.returnRecipientName != null && !requestedRecipientName) {
      return c.json({ error: 'Return recipient name is required' }, 400);
    }
    if (requestedRecipientName && requestedRecipientName.length > 120) {
      return c.json({ error: 'Return recipient name must be 120 characters or fewer' }, 400);
    }
    const returnRecipientName = requestedRecipientName
      ?? returnRecipientNameFromOrder(order.raw, clientName);

    // CP-058 AC-1 — a return must say WHY it was started.
    //
    // This was optional and stored as NULL. The reason is the only field that separates
    // a customer-remorse return from a damaged/wrong-item one, and unlike a weight or an
    // address it CANNOT be reconstructed after the fact — nobody remembers next month.
    // Required at creation because that is the only moment the person starting it knows.
    //
    // Enforced HERE rather than as a NOT NULL column: existing returns legitimately have
    // a null reason, and a column constraint would either reject them or need a made-up
    // backfill value, which is the same lost information wearing a disguise.
    const requestedReason = body.reason?.trim();
    if (!requestedReason) {
      return c.json({ error: 'A return reason is required' }, 400);
    }
    if (requestedReason.length > 500) {
      return c.json({ error: 'Return reason must be 500 characters or fewer' }, 400);
    }

    const initiatedBy = scope.isGlobal ? 'three_pl' : 'client';
    const returnReference = await buildReturnReference(orderId, order.orderNumber);
    const orderedRows = await db
      .select({ id: orderItems.id, sku: orderItems.sku, name: orderItems.name, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const orderedBySku = new Map<string, { qty: number; id: number; name: string | null }>();
    const orderedById = new Map<number, { sku: string; qty: number }>();
    for (const row of orderedRows) {
      orderedBySku.set(row.sku.toLowerCase(), { qty: Number(row.quantity) || 0, id: row.id, name: row.name });
      orderedById.set(row.id, { sku: row.sku, qty: Number(row.quantity) || 0 });
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const cleanItems: Array<{ sku: string; name: string | null; quantity: number; orderItemId: number | null }> = [];
    for (const item of rawItems.slice(0, 200)) {
      const sku = (item?.sku ?? '').trim();
      const quantity = Number(item?.quantity) || 0;
      if (!sku || quantity <= 0) continue;
      const ordered = orderedBySku.get(sku.toLowerCase());
      if (ordered && quantity > ordered.qty) {
        return c.json({ error: `Return quantity for ${sku} (${quantity}) exceeds the ordered quantity (${ordered.qty})` }, 400);
      }

      let orderItemId: number | null;
      if (typeof item?.orderItemId === 'number') {
        const owned = orderedById.get(item.orderItemId);
        if (!owned || owned.sku.toLowerCase() !== sku.toLowerCase()) {
          return c.json(
            { error: `orderItemId ${item.orderItemId} does not belong to this order or does not match SKU ${sku}` },
            400,
          );
        }
        orderItemId = item.orderItemId;
      } else {
        orderItemId = ordered?.id ?? null;
      }
      cleanItems.push({
        sku,
        name: (item?.name ?? ordered?.name ?? '').trim() || null,
        quantity,
        orderItemId,
      });
    }
    if (!cleanItems.length) {
      return c.json({ error: 'At least one returned item with a positive quantity is required' }, 400);
    }

    let created: Return;
    try {
      const [row] = await db
        .insert(returns)
        .values({
          orderId,
          clientId,
          returnReference: returnReference,
          status: 'requested',
          initiatedBy,
          initiatedByEmail: scope.email ?? null,
          reason: requestedReason,
          returnRecipientName,
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

    await db.insert(returnItems).values(
      cleanItems.map((item) => ({
        returnId: created.id,
        orderId,
        orderItemId: item.orderItemId,
        sku: item.sku,
        name: item.name,
        quantity: String(item.quantity),
      })),
    );
    await recordReturnActivity({
      returnId: created.id,
      eventType: 'return_requested',
      status: 'requested',
      actorType: initiatedBy === 'client' ? 'client' : 'operator',
      actorEmail: scope.email,
      eventAt: created.requestedAt,
    });
    await recordPortalAudit('portal.returns.create', scope, {
      returnId: created.id,
      orderId,
      items: cleanItems.length,
      initiatedBy,
    });
    return c.json({ data: { id: created.id, status: created.status } }, 201);
  });
}

function registerReturnRecipientNameRoute(app: Hono): void {
  app.patch('/returns/:id{[0-9]+}/recipient-name', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as { returnRecipientName?: string };
    const returnRecipientName = body.returnRecipientName?.trim() ?? '';
    if (!returnRecipientName) return c.json({ error: 'Return recipient name is required' }, 400);
    if (returnRecipientName.length > 120) {
      return c.json({ error: 'Return recipient name must be 120 characters or fewer' }, 400);
    }

    const [ret] = await db
      .select({ id: returns.id, returnShipmentId: returns.returnShipmentId })
      .from(returns)
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!ret) return c.json({ error: 'Return not found' }, 404);
    if (ret.returnShipmentId != null) {
      return c.json({ error: 'The return recipient cannot be changed after the label is created.' }, 409);
    }

    await db
      .update(returns)
      .set({ returnRecipientName, updatedAt: new Date() })
      .where(eq(returns.id, id));
    await recordPortalAudit('portal.returns.recipient_name.update', scope, { returnId: id });
    return c.json({ data: { id, returnRecipientName } });
  });
}

function registerReturnLabelRoute(app: Hono): void {
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
        actorType: scope.isGlobal ? 'operator' : 'client',
        authorization: c.req.header('authorization'),
      });
      await recordPortalAudit('portal.returns.label.create', scope, { returnId: id });
      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create return label';
      const isDuplicate = /active return already exists/i.test(message);
      const isRateUnavailable = err instanceof ReturnLabelRateUnavailableError;
      const isPurchasePending = err instanceof ReturnLabelPurchasePendingError;
      const assignmentConflict = err instanceof ReturnLabelAssignmentConflictError ? err : null;
      const isAssignmentConflict = isPurchasePending || assignmentConflict != null;
      const isInvalidState = err instanceof ReturnLabelStateError;
      const isCustomerRateUnavailable = err instanceof ReturnCustomerRateUnavailableError;
      if (isRateUnavailable) {
        const { rawRateCount, returnLabelRatePolicy, ...safeDiagnostics } = err.diagnostics;
        await recordPortalAudit('portal.returns.label.rate_unavailable', scope, {
          ...safeDiagnostics,
          quotedRateCount: rawRateCount,
          ratePolicy: returnLabelRatePolicy,
        });
      }
      const status = isDuplicate || isInvalidState || isAssignmentConflict
        ? 409
        : isRateUnavailable || isCustomerRateUnavailable
          ? 422
          : 500;
      const clientMessage =
        isDuplicate || isInvalidState || isAssignmentConflict || isRateUnavailable ||
        isCustomerRateUnavailable
          ? message
          : 'Could not create return label. Please try again or contact PrepShip support.';
      return c.json(
        {
          error: clientMessage,
          ...(isAssignmentConflict ? { code: RETURN_LABEL_ASSIGNMENT_CONFLICT_CODE } : {}),
        },
        status,
      );
    }
  });
}

function registerReturnDeliveryRoute(app: Hono): void {
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
    await recordReturnActivity({
      returnId: id,
      shipmentId: ret.returnShipmentId,
      eventType: 'label_delivered',
      status: result.deliveryStatus,
      actorType: scope.isGlobal ? 'operator' : 'client',
      actorEmail: scope.email,
    });
    await recordPortalAudit('portal.returns.deliver', scope, {
      returnId: id,
      method: result.deliveryMethod,
      status: result.deliveryStatus,
    });
    return c.json({ data: result });
  });
}

export function registerReturnActionRoutes(app: Hono): void {
  registerReturnCreateRoute(app);
  registerReturnRecipientNameRoute(app);
  registerReturnLabelRoute(app);
  registerReturnDeliveryRoute(app);
  registerReturnExternalTrackingRoute(app);
  registerReturnExternalLabelPdfRoute(app);
  registerReturnBillingDateRoute(app);
}

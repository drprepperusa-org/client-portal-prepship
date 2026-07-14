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
} from '../../../services/returns';
import { buildReturnReference, returnScopePredicate } from './shared';

function registerReturnCreateRoute(app: Hono): void {
  app.post('/returns', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;

    const body = (await c.req.json().catch(() => ({}))) as {
      orderId?: number;
      reason?: string;
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
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), orderScopePredicate(scope) ?? sql`true`))
      .limit(1);
    if (!order) return c.json({ error: 'Order not found or outside your access scope' }, 404);

    let clientId = order.clientId ?? null;
    if (clientId == null && order.storeId != null) {
      const [match] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(sql`${clients.storeIds} @> ${[order.storeId]}::integer[]`)
        .limit(1);
      clientId = match?.id ?? null;
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
      });
      await recordPortalAudit('portal.returns.label.create', scope, { returnId: id });
      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create return label';
      const isDuplicate = /active return already exists/i.test(message);
      const isRateUnavailable = err instanceof ReturnLabelRateUnavailableError;
      const isPurchasePending = err instanceof ReturnLabelPurchasePendingError;
      const isInvalidState = err instanceof ReturnLabelStateError;
      if (isRateUnavailable) {
        const { rawRateCount, returnLabelRatePolicy, ...safeDiagnostics } = err.diagnostics;
        await recordPortalAudit('portal.returns.label.rate_unavailable', scope, {
          ...safeDiagnostics,
          quotedRateCount: rawRateCount,
          ratePolicy: returnLabelRatePolicy,
        });
      }
      const status = isDuplicate || isInvalidState || isPurchasePending ? 409 : isRateUnavailable ? 422 : 500;
      const clientMessage =
        isDuplicate || isInvalidState || isPurchasePending || isRateUnavailable
          ? message
          : 'Could not create return label. Please try again or contact PrepShip support.';
      return c.json({ error: clientMessage }, status);
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
  registerReturnLabelRoute(app);
  registerReturnDeliveryRoute(app);
}

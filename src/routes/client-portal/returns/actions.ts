import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { uploadReturnInspectionMedia } from '../../../lib/supabase';
import { env } from '../../../lib/env';
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
import { EXTERNAL_TRACKING_RETURN_STATUS, resolveReturnExternalTracking } from '../../../services/return-external-tracking';
import { applyReturnExternalTracking } from '../../../services/return-external-tracking-apply';
import {
  createReturnLabel,
  ReturnLabelPurchasePendingError,
  ReturnLabelRateUnavailableError,
  ReturnLabelStateError,
  ReturnCustomerRateUnavailableError,
} from '../../../services/returns';
import { buildReturnReference, returnScopePredicate } from './shared';

const DEFAULT_RETURN_RECIPIENT_NAME = 'DR PREPPER LLC';

/** CP-058: an external return label PDF is a document, not media — 10 MB is ample. */
const EXTERNAL_LABEL_PDF_MAX_BYTES = 10 * 1024 * 1024;

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
      const status = isDuplicate || isInvalidState || isPurchasePending
        ? 409
        : isRateUnavailable || isCustomerRateUnavailable
          ? 422
          : 500;
      const clientMessage =
        isDuplicate || isInvalidState || isPurchasePending || isRateUnavailable ||
        isCustomerRateUnavailable
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
  registerReturnRecipientNameRoute(app);
  registerReturnLabelRoute(app);
  registerReturnDeliveryRoute(app);
  registerReturnExternalTrackingRoute(app);
  registerReturnExternalLabelPdfRoute(app);
  registerReturnBillingDateRoute(app);
}

function registerReturnExternalTrackingRoute(app: Hono): void {
  // CP-058 AC-3/AC-4 — record a return label bought OUTSIDE PrepShip.
  //
  // Thin: it loads the return in scope, hands the decision to the canonical rule, and
  // delegates the write. It calls no carrier and computes no customer rate. The rule
  // refuses when a PrepShip label already owns this return's tracking state, so the two
  // paths can never both claim it.
  app.post('/returns/:id{[0-9]+}/external-tracking', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));

    const body = (await c.req.json().catch(() => ({}))) as {
      trackingNumber?: unknown;
      labelCost?: unknown;
    };

    const [ret] = await db
      .select({
        id: returns.id,
        orderId: returns.orderId,
        clientId: returns.clientId,
        status: returns.status,
        returnShipmentId: returns.returnShipmentId,
      })
      .from(returns)
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!ret) return c.json({ error: 'Return not found' }, 404);

    const decision = resolveReturnExternalTracking({
      return: { status: ret.status, returnShipmentId: ret.returnShipmentId },
      trackingNumber: body.trackingNumber,
      labelCost: body.labelCost,
    });
    if (decision.kind === 'rejected') {
      // 409 for a state conflict (already labelled / past the window), 400 for input.
      const status =
        decision.code === 'label_already_exists' || decision.code === 'status_not_labelable'
          ? 409
          : 400;
      return c.json({ error: decision.message, code: decision.code }, status);
    }

    const [order] = await db
      .select({ orderNumber: orders.orderNumber })
      .from(orders)
      .where(eq(orders.id, ret.orderId))
      .limit(1);

    const result = await applyReturnExternalTracking({
      returnId: ret.id,
      orderId: ret.orderId,
      clientId: ret.clientId,
      orderNumber: order?.orderNumber ?? null,
      decision,
      actorEmail: scope.email,
      actorType: scope.isGlobal ? 'operator' : 'client',
    });

    await recordPortalAudit('portal.returns.external_tracking.assign', scope, {
      returnId: id,
      returnShipmentId: result.returnShipmentId,
      trackingNumber: decision.trackingNumber,
    });
    return c.json({
      data: {
        id: ret.id,
        status: EXTERNAL_TRACKING_RETURN_STATUS,
        returnShipmentId: result.returnShipmentId,
      },
    });
  });
}

function registerReturnExternalLabelPdfRoute(app: Hono): void {
  // CP-058 AC-3/AC-4 — the OPTIONAL PDF for an externally purchased return label.
  //
  // Reuses the CP-030 private-bucket path exactly: the service role uploads, the DB keeps
  // only the object path, and readers get a short-lived signed URL. The bucket is never
  // public, which is what AC-4's "private/scoped" requires — a second storage mechanism
  // here would be a second place to get that wrong.
  //
  // Only attachable to a return whose label came from OUTSIDE PrepShip. A PrepShip label
  // already has its own PDF, and letting this overwrite it would give one return two
  // competing label documents.
  app.post('/returns/:id{[0-9]+}/external-label-pdf', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));

    const [ret] = await db
      .select({
        id: returns.id,
        returnShipmentId: returns.returnShipmentId,
        shipmentSource: shipments.source,
        existingLabelUrl: shipments.labelUrl,
      })
      .from(returns)
      .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!ret) return c.json({ error: 'Return not found' }, 404);
    if (ret.returnShipmentId == null) {
      return c.json({ error: 'Assign external tracking before attaching a label PDF' }, 409);
    }
    if (ret.shipmentSource !== 'external_return_label') {
      return c.json(
        { error: 'This return has a PrepShip label; its PDF cannot be replaced.' },
        409,
      );
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data with a file field' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'A PDF file is required' }, 400);
    if (file.size > EXTERNAL_LABEL_PDF_MAX_BYTES) {
      return c.json({ error: 'The label PDF exceeds the 10 MB limit' }, 413);
    }
    if (file.type !== 'application/pdf') {
      return c.json({ error: 'The label must be a PDF' }, 400);
    }

    const safeName = (file.name || 'label.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const objectPath = `returns/${id}/external-label/${randomUUID()}-${safeName}`;
    try {
      await uploadReturnInspectionMedia(objectPath, await file.arrayBuffer(), 'application/pdf');
    } catch (err) {
      console.error('[returns] external label pdf upload failed:', err instanceof Error ? err.message : err);
      return c.json({ error: 'Label PDF upload failed. Please retry.' }, 502);
    }

    // Persist only the durable object PATH, never the binary or a public URL.
    await db
      .update(shipments)
      .set({ labelUrl: objectPath, labelFormat: 'pdf' })
      .where(eq(shipments.id, ret.returnShipmentId));

    await recordReturnActivity({
      returnId: id,
      shipmentId: ret.returnShipmentId,
      eventType: 'external_tracking_assigned',
      status: 'label_created',
      detail: JSON.stringify({ externalLabelPdf: safeName }),
      actorType: scope.isGlobal ? 'operator' : 'client',
      actorEmail: scope.email,
    });
    await recordPortalAudit('portal.returns.external_label_pdf.upload', scope, {
      returnId: id,
      returnShipmentId: ret.returnShipmentId,
    });
    return c.json({ data: { id, pdfAttached: true } }, 201);
  });
}

function registerReturnBillingDateRoute(app: Hono): void {
  // CP-058 AC-6 — STAFF-ONLY correction of a return's billing date.
  //
  // A pure proxy to PrepShip's canonical route (PS-487 AC-4/AC-7), on the same pattern
  // as /billing/generate: it forwards the caller's own bearer token, so PrepShip
  // re-authorises the request rather than trusting the portal's say-so, and it decides
  // nothing about dates, finalized periods or adjustments.
  //
  // The client/staff split is enforced HERE as well as upstream: AC-6 says clients can
  // neither edit the date nor see the audit, so a non-global scope is refused with a 404
  // — the same answer as a return that does not exist. A 403 would confirm the endpoint
  // exists and that this return is real.
  app.patch('/returns/:id{[0-9]+}/billing-date', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));

    if (!scope.isGlobal) {
      await recordPortalAudit('portal.returns.billing_date.denied', scope, { returnId: id });
      return c.json({ error: 'Return not found' }, 404);
    }

    // Scope check still applies to staff: the return must be visible to this caller.
    const [ret] = await db
      .select({ id: returns.id })
      .from(returns)
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!ret) return c.json({ error: 'Return not found' }, 404);

    const authorization = c.req.header('authorization');
    if (!authorization) return c.json({ error: 'Missing bearer token' }, 401);
    if (!env.PREPSHIP_API_URL) {
      return c.json({
        error: 'Return billing-date correction is not configured. Set PREPSHIP_API_URL on the Client Portal API.',
        code: 'prep_ship_billing_unavailable',
      }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    await recordPortalAudit('portal.returns.billing_date.requested', scope, { returnId: id });

    let upstream: Response;
    try {
      const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
      upstream = await fetch(`${baseUrl}/billing/returns/${id}/billing-date`, {
        method: 'PATCH',
        headers: {
          authorization,
          accept: 'application/json',
          'content-type': 'application/json',
          ...(c.req.header('x-request-id') ? { 'x-request-id': c.req.header('x-request-id')! } : {}),
        },
        body: JSON.stringify({
          newBillingDay: body.newBillingDay,
          reason: body.reason,
          djApprovalReference: body.djApprovalReference ?? null,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      console.error(
        '[client-portal] return billing-date correction unavailable:',
        error instanceof Error ? error.message : 'unknown error',
      );
      return c.json({ error: 'PrepShip is unavailable. Please retry.', code: 'prep_ship_unavailable' }, 502);
    }

    // Pass the canonical answer through verbatim — including 409 for a finalized period
    // needing DJ approval. Re-wording it here would hide why the correction was refused.
    const payload = await upstream.json().catch(() => ({}));
    return c.json(payload as Record<string, unknown>, upstream.status as never);
  });
}

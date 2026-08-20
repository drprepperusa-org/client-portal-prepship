import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import {
  removeReturnInspectionMedia,
  uploadReturnInspectionMedia,
} from '../../../lib/supabase';
import { orders } from '../../../db/schema/orders';
import { returns } from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { recordReturnActivity } from '../../../services/return-activity';
import { EXTERNAL_TRACKING_RETURN_STATUS, resolveReturnExternalTracking } from '../../../services/return-external-tracking';
import {
  applyReturnExternalTracking,
  attachReturnExternalLabelPdf,
} from '../../../services/return-external-tracking-apply';
import { ReturnLabelAssignmentConflictError } from '../../../services/return-label-slot';
import { returnScopePredicate } from './shared';

/** CP-058: an external return label PDF is a document, not media — 10 MB is ample. */
const EXTERNAL_LABEL_PDF_MAX_BYTES = 10 * 1024 * 1024;

export function registerReturnExternalTrackingRoute(app: Hono): void {
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
      amountPaid?: unknown;
    };

    const [ret] = await db
      .select({
        id: returns.id,
        orderId: returns.orderId,
        clientId: returns.clientId,
        status: returns.status,
        returnShipmentId: returns.returnShipmentId,
        returnShipmentVoided: shipments.voided,
      })
      .from(returns)
      .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!ret) return c.json({ error: 'Return not found' }, 404);

    const decision = resolveReturnExternalTracking({
      return: {
        status: ret.status,
        returnShipmentId: ret.returnShipmentId,
        linkedShipmentVoided: ret.returnShipmentVoided === true,
      },
      trackingNumber: body.trackingNumber,
      amountPaid: body.amountPaid,
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

    let result: { returnShipmentId: number };
    try {
      result = await applyReturnExternalTracking({
        returnId: ret.id,
        orderId: ret.orderId,
        clientId: ret.clientId,
        orderNumber: order?.orderNumber ?? null,
        decision,
        actorEmail: scope.email,
        actorType: scope.isGlobal ? 'operator' : 'client',
      });
    } catch (error) {
      if (error instanceof ReturnLabelAssignmentConflictError) {
        return c.json({ error: error.message, code: error.code }, 409);
      }
      throw error;
    }

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

export function registerReturnExternalLabelPdfRoute(app: Hono): void {
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
    try {
      await attachReturnExternalLabelPdf({
        returnId: id,
        expectedShipmentId: ret.returnShipmentId,
        objectPath,
      });
    } catch (error) {
      try {
        await removeReturnInspectionMedia(objectPath);
      } catch (cleanupError) {
        console.error(
          '[returns] external label pdf cleanup failed:',
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
        );
      }
      if (error instanceof ReturnLabelAssignmentConflictError) {
        return c.json({ error: error.message, code: error.code }, 409);
      }
      throw error;
    }

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

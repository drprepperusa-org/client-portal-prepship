import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { locations } from '../../../db/schema/locations';
import { orders } from '../../../db/schema/orders';
import {
  returnInspectionMedia,
  returnInspections,
  returns,
} from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { requestedSearch, scopeOrResponse } from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { uploadReturnInspectionMedia } from '../../../lib/supabase';
import { resolveReturnArrival, returnArrivedReadyToReceiveSql } from '../../../services/return-arrival';
import { resolveReturnReference } from '../../../services/return-reference';
import {
  canRecordAuthoritativeReturnInspection,
  INSPECTION_CONDITIONS,
  INSPECTION_MEDIA_TYPES,
  iso,
  operatorGateOrResponse,
  PHOTO_MAX_BYTES,
  RECEIVING_STATUSES,
  returnScopePredicate,
  returnSearchPredicate,
  VIDEO_MAX_BYTES,
} from './shared';

const MEDIA_REQUEST_MAX_BYTES = VIDEO_MAX_BYTES + 1024 * 1024;

function registerReceivingQueueRoute(app: Hono): void {
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
        returnTrackingStatus: shipments.trackingStatus,
        returnDeliveredAt: shipments.deliveredAt,
        returnShipmentVoided: shipments.voided,
      })
      .from(returns)
      .leftJoin(orders, eq(orders.id, returns.orderId))
      .leftJoin(clients, eq(clients.id, returns.clientId))
      .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
      .leftJoin(locations, eq(locations.id, returns.returnToLocationId))
      .where(where)
      // CP-062 (AC-3): parcels the carrier has delivered but the warehouse has not received come
      // first, across the whole page — the SQL twin of the read model's arrival rule. Then newest.
      .orderBy(desc(returnArrivedReadyToReceiveSql()), desc(returns.requestedAt), desc(returns.id))
      .limit(100);

    await recordPortalAudit('portal.returns.receiving.list', scope, { rows: rows.length, search });
    return c.json({
      data: rows.map((row) => ({
        id: row.ret.id,
        orderId: row.ret.orderId,
        orderNumber: row.orderNumber,
        returnReference: resolveReturnReference(row.ret.returnReference, row.orderNumber, row.ret.orderId),
        clientName: row.clientName,
        status: row.ret.status,
        trackingNumber: row.returnTracking,
        // CP-062: trackingStatus, deliveredAt, arrivedReadyToReceive — the same owner the list uses.
        ...resolveReturnArrival({
          status: row.ret.status,
          trackingStatus: row.returnTrackingStatus,
          deliveredAt: row.returnDeliveredAt,
          shipmentVoided: row.returnShipmentVoided,
        }),
        returnToLocation: row.returnToLocationName,
        requestedAt: iso(row.ret.requestedAt),
      })),
    });
  });
}

function registerInspectionRoute(app: Hono): void {
  app.post('/returns/:id{[0-9]+}/inspection', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));

    const [ret] = await db
      .select({
        id: returns.id,
        returnShipmentId: returns.returnShipmentId,
        status: returns.status,
      })
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
    const isOperator = canRecordAuthoritativeReturnInspection(scope);
    const attemptedAuthoritativeWrite =
      body.receivedAt !== undefined ||
      body.condition !== undefined ||
      body.status !== undefined;
    if (!isOperator && attemptedAuthoritativeWrite) {
      await recordPortalAudit('portal.returns.inspection.authority_denied', scope, {
        returnId: id,
        attemptedFields: [
          body.receivedAt !== undefined ? 'receivedAt' : null,
          body.condition !== undefined ? 'condition' : null,
          body.status !== undefined ? 'status' : null,
        ].filter(Boolean),
      });
      return c.json(
        { error: 'Warehouse receipt, condition, and inspection status require operator access' },
        403,
      );
    }

    const condition = typeof body.condition === 'string' && body.condition.trim() ? body.condition.trim() : null;
    if (condition && !INSPECTION_CONDITIONS.has(condition)) {
      return c.json({ error: `Invalid condition. Expected one of: ${[...INSPECTION_CONDITIONS].join(', ')}` }, 400);
    }
    const receivedAt = isOperator
      ? body.receivedAt
        ? new Date(body.receivedAt)
        : new Date()
      : null;
    if (receivedAt && Number.isNaN(receivedAt.getTime())) {
      return c.json({ error: 'Invalid receivedAt' }, 400);
    }
    const comments = typeof body.comments === 'string' && body.comments.trim() ? body.comments.trim().slice(0, 2000) : null;
    const derivedStatus =
      condition === 'sealed_new' || condition === 'opened_good'
        ? 'passed'
        : condition === 'damaged' || condition === 'missing_item' || condition === 'wrong_item'
          ? 'failed'
          : 'pending';
    const status = isOperator && ['pending', 'passed', 'failed'].includes(body.status ?? '')
      ? (body.status as string)
      : isOperator
        ? derivedStatus
        : 'pending';
    const inspectorType = isOperator ? 'operator' : 'client';

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
        inspectorType,
      })
      .returning({ id: returnInspections.id });
    const inspectionId = inserted!.id;

    const nextReturnStatus = isOperator
      ? condition
        ? 'inspected'
        : 'received'
      : ret.status;
    if (isOperator) {
      await db
        .update(returns)
        .set({ status: nextReturnStatus, updatedAt: new Date() })
        .where(and(eq(returns.id, id), sql`${returns.status} not in ('closed', 'cancelled')`));
    }

    await recordPortalAudit('portal.returns.inspection.record', scope, {
      returnId: id,
      inspectionId,
      condition,
      status,
      inspectorType,
      authority: isOperator ? 'operator_inspection' : 'client_evidence',
      returnStatus: nextReturnStatus,
    });
    return c.json({ data: { id: inspectionId, returnId: id, status, condition, returnStatus: nextReturnStatus } }, 201);
  });
}

function registerInspectionMediaRoute(app: Hono): void {
  app.post('/returns/:id{[0-9]+}/inspection/:iid{[0-9]+}/media', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const id = Number(c.req.param('id'));
    const iid = Number(c.req.param('iid'));

    const [match] = await db
      .select({
        inspectionId: returnInspections.id,
        inspectorType: returnInspections.inspectorType,
      })
      .from(returnInspections)
      .innerJoin(returns, eq(returns.id, returnInspections.returnId))
      .where(and(eq(returnInspections.id, iid), eq(returnInspections.returnId, id), returnScopePredicate(scope)))
      .limit(1);
    if (!match) return c.json({ error: 'Inspection not found' }, 404);
    if (
      !canRecordAuthoritativeReturnInspection(scope) &&
      match.inspectorType !== 'client'
    ) {
      await recordPortalAudit('portal.returns.inspection.media.authority_denied', scope, {
        returnId: id,
        inspectionId: iid,
      });
      return c.json(
        { error: 'Client evidence can only be attached to a client submission' },
        403,
      );
    }

    const declaredLen = Number(c.req.header('content-length') ?? 0);
    if (declaredLen > MEDIA_REQUEST_MAX_BYTES) {
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
    const maxBytes = mediaType === 'photo' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES;
    if (file.size > maxBytes) {
      const maxMb = mediaType === 'photo' ? 15 : 25;
      return c.json({ error: `File exceeds the ${maxMb} MB ${mediaType} limit` }, 413);
    }
    if (
      (mediaType === 'photo' && !file.type.startsWith('image/')) ||
      (mediaType === 'video' && !file.type.startsWith('video/'))
    ) {
      return c.json({ error: `The uploaded file does not match mediaType '${mediaType}'` }, 400);
    }
    const capturedRaw = form.get('capturedAt');
    const capturedAt = typeof capturedRaw === 'string' && capturedRaw ? new Date(capturedRaw) : new Date();
    if (Number.isNaN(capturedAt.getTime())) return c.json({ error: 'Invalid capturedAt' }, 400);
    const contentType = file.type.slice(0, 200);
    const safeName = (file.name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const objectPath = `returns/${id}/inspection/${iid}/${randomUUID()}-${safeName}`;

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
        originalFileName: safeName,
        uploadedByEmail: scope.email ?? null,
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
}

export function registerReturnReceivingRoutes(app: Hono): void {
  registerReceivingQueueRoute(app);
  registerInspectionRoute(app);
  registerInspectionMediaRoute(app);
}

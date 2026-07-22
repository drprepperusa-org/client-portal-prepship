import type { Hono } from 'hono';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { locations } from '../../../db/schema/locations';
import { orders } from '../../../db/schema/orders';
import {
  returnInspectionMedia,
  returnInspections,
  returnItems,
  returns,
  type ReturnItem,
} from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import {
  parsePage,
  parsePageSize,
  parsePositiveInt,
  requestedClientId,
  requestedSearch,
  requestedStoreId,
  scopeOrResponse,
} from '../../../lib/client-portal/query-params';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { refreshMockLabelSignature } from '../../../lib/mock-label-access';
import { validatedReturnCustomerShippingRateSql } from '../../../lib/client-portal/customer-shipping-rate';
import { getReturnMediaSignedUrl } from '../../../lib/supabase';
import { listOriginalOrderActivity, listReturnActivity } from '../../../services/return-activity';
import { resolveReturnReference } from '../../../services/return-reference';
import { toClientSafeReturnRow } from './dto';
import {
  iso,
  RETURN_STATUS_FILTERS,
  returnScopePredicate,
  returnSearchPredicate,
} from './shared';

function registerReturnListRoute(app: Hono): void {
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

    const rows = await db
      .select({
        ret: returns,
        orderNumber: orders.orderNumber,
        clientName: clients.name,
        returnTracking: sql<string | null>`coalesce(${shipments.labelTracking}, ${shipments.trackingNumber})`,
        returnCarrier: shipments.labelCarrier,
        returnLabelUrl: shipments.labelUrl,
        validatedReturnCustomerShippingRate: validatedReturnCustomerShippingRateSql(),
        returnedSkus: sql<string[]>`coalesce((
          select array_agg(ri.sku order by ri.id)
          from return_items ri
          where ri.return_id = ${returns.id}
        ), array[]::text[])`,
        returnedQuantity: sql<number>`coalesce((
          select sum(ri.quantity)::double precision
          from return_items ri
          where ri.return_id = ${returns.id}
        ), 0)`,
        recipientName: sql<string | null>`coalesce(
          nullif(btrim(${orders.raw}->'shipTo'->>'name'), ''),
          nullif(btrim(${orders.shipToName}), '')
        )`,
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

    await recordPortalAudit('portal.returns.list', scope, {
      page,
      pageSize,
      status: status ?? null,
      clientId,
      storeId,
      search,
    });
    return c.json({
      data: await Promise.all(
        rows.map((row) => toClientSafeReturnRow(row, { includeFinancials: scope.canViewFinancials })),
      ),
      pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
    });
  });
}

function registerReturnLocationsRoute(app: Hono): void {
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
}

function registerReturnDetailRoute(app: Hono): void {
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
        returnCarrier: shipments.labelCarrier,
        returnLabelUrl: shipments.labelUrl,
        validatedReturnCustomerShippingRate: validatedReturnCustomerShippingRateSql(),
        returnedSkus: sql<string[]>`coalesce((
          select array_agg(ri.sku order by ri.id)
          from return_items ri
          where ri.return_id = ${returns.id}
        ), array[]::text[])`,
        returnedQuantity: sql<number>`coalesce((
          select sum(ri.quantity)::double precision
          from return_items ri
          where ri.return_id = ${returns.id}
        ), 0)`,
        recipientName: sql<string | null>`coalesce(
          nullif(btrim(${orders.raw}->'shipTo'->>'name'), ''),
          nullif(btrim(${orders.shipToName}), '')
        )`,
      })
      .from(returns)
      .leftJoin(orders, eq(orders.id, returns.orderId))
      .leftJoin(clients, eq(clients.id, returns.clientId))
      .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
      .where(and(eq(returns.id, id), returnScopePredicate(scope)))
      .limit(1);
    if (!row) return c.json({ error: 'Return not found' }, 404);

    const items = await db.select().from(returnItems).where(eq(returnItems.returnId, id)).orderBy(returnItems.id);
    const inspections = await db
      .select()
      .from(returnInspections)
      .where(eq(returnInspections.returnId, id))
      .orderBy(desc(returnInspections.id));
    const [activity, orderActivity] = await Promise.all([
      listReturnActivity(id),
      listOriginalOrderActivity(row.ret.orderId),
    ]);
    const inspectionIds = inspections.map((inspection) => inspection.id);
    const media = inspectionIds.length
      ? await db.select().from(returnInspectionMedia).where(inArray(returnInspectionMedia.inspectionId, inspectionIds))
      : [];
    const mediaByInspection = new Map<number, typeof media>();
    for (const item of media) {
      const list = mediaByInspection.get(item.inspectionId) ?? [];
      list.push(item);
      mediaByInspection.set(item.inspectionId, list);
    }
    const mediaUrlById = new Map<number, string | null>();
    await Promise.all(
      media.map(async (item) => {
        mediaUrlById.set(item.id, await getReturnMediaSignedUrl(item.storageRef));
      }),
    );

    const safeRow = await toClientSafeReturnRow(row, { includeFinancials: scope.canViewFinancials });
    await recordPortalAudit('portal.returns.detail.view', scope, {
      returnId: id,
      clientId: row.ret.clientId,
    });
    return c.json({
      data: {
        ...safeRow,
        trackingStatus: row.returnTrackingStatus ?? null,
        deliveryError: row.ret.deliveryError,
        returnToLocationId: row.ret.returnToLocationId,
        pdfUrl: refreshMockLabelSignature(row.returnLabelUrl),
        requestedAt: iso(row.ret.requestedAt),
        closedAt: iso(row.ret.closedAt),
        items: items.map((item: ReturnItem) => ({
          id: item.id,
          sku: item.sku,
          name: item.name,
          quantity: Number(item.quantity),
          orderItemId: item.orderItemId,
        })),
        inspections: inspections.map((inspection) => ({
          id: inspection.id,
          status: inspection.status,
          condition: inspection.condition,
          comments: inspection.comments,
          receivedAt: iso(inspection.receivedAt),
          actorLabel: inspection.inspectorType === 'client'
            ? 'Client'
            : inspection.inspectorEmail
              ? 'PrepShip'
              : 'System',
          createdAt: iso(inspection.createdAt),
          updatedAt: iso(inspection.updatedAt),
          media: (mediaByInspection.get(inspection.id) ?? []).map((item) => ({
            id: item.id,
            mediaType: item.mediaType,
            url: mediaUrlById.get(item.id) ?? null,
            contentType: item.contentType,
            fileName: item.originalFileName,
            sizeBytes: item.sizeBytes,
            capturedAt: iso(item.capturedAt),
            uploadedAt: iso(item.createdAt),
          })),
        })),
        activity,
        orderActivity,
      },
    });
  });
}

export function registerReturnReadRoutes(app: Hono): void {
  registerReturnListRoute(app);
  registerReturnLocationsRoute(app);
  registerReturnDetailRoute(app);
}

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { orders } from '../db/schema/orders';
import { shipments } from '../db/schema/shipments';
import { returnActivityEvents, returns } from '../db/schema/returns';

export type ReturnActivityEventType =
  | 'return_requested'
  | 'label_created'
  | 'label_failed'
  | 'label_delivered'
  | 'tracking_status_changed'
  | 'return_closed'
  | 'return_cancelled';

type RecordReturnActivityInput = {
  returnId: number;
  eventType: ReturnActivityEventType;
  status?: string | null;
  detail?: string | null;
  actorType?: 'client' | 'operator' | 'system';
  actorEmail?: string | null;
  shipmentId?: number | null;
  eventAt?: Date;
};

/** History must never break its canonical action, so event persistence is best effort. */
export async function recordReturnActivity(input: RecordReturnActivityInput): Promise<void> {
  try {
    await db.insert(returnActivityEvents).values({
      returnId: input.returnId,
      shipmentId: input.shipmentId ?? null,
      eventType: input.eventType,
      status: input.status ?? null,
      detail: input.detail?.slice(0, 500) ?? null,
      actorType: input.actorType ?? 'system',
      actorEmail: input.actorEmail ?? null,
      eventAt: input.eventAt ?? new Date(),
    });
  } catch (error) {
    console.warn('[returns] activity event persistence failed:', error instanceof Error ? error.message : error);
  }
}

export async function recordReturnTrackingActivities(
  updates: Array<{ shipmentId: number; status: string; eventAt: Date }>,
): Promise<void> {
  if (!updates.length) return;
  const links = await db
    .select({ returnId: returns.id, shipmentId: returns.returnShipmentId })
    .from(returns)
    .where(inArray(returns.returnShipmentId, updates.map((update) => update.shipmentId)));
  const updateByShipment = new Map(updates.map((update) => [update.shipmentId, update]));
  const values = links.flatMap((link) => {
    if (link.shipmentId == null) return [];
    const update = updateByShipment.get(link.shipmentId);
    if (!update) return [];
    return [{
      returnId: link.returnId,
      shipmentId: link.shipmentId,
      eventType: 'tracking_status_changed',
      status: update.status,
      actorType: 'system',
      eventAt: update.eventAt,
    }];
  });
  if (!values.length) return;
  try {
    await db.insert(returnActivityEvents).values(values);
  } catch (error) {
    console.warn('[returns] tracking activity persistence failed:', error instanceof Error ? error.message : error);
  }
}

export async function listReturnActivity(returnId: number) {
  const rows = await db
    .select()
    .from(returnActivityEvents)
    .where(eq(returnActivityEvents.returnId, returnId))
    .orderBy(desc(returnActivityEvents.eventAt), desc(returnActivityEvents.id))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    detail: row.detail,
    actorLabel: row.actorType === 'client' ? 'Client' : row.actorType === 'operator' ? 'PrepShip' : 'System',
    eventAt: row.eventAt.toISOString(),
  }));
}

/** Redacted original-order milestones. Shipment identity/rates/carriers never leave the backend. */
export async function listOriginalOrderActivity(orderId: number) {
  const [order, outbound] = await Promise.all([
    db
      .select({ id: orders.id, orderDate: orders.orderDate, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1),
    db
      .select({
        id: shipments.id,
        shipDate: shipments.shipDate,
        createDate: shipments.createDate,
        labelCreatedAt: shipments.labelCreatedAt,
        deliveredAt: shipments.deliveredAt,
      })
      .from(shipments)
      .where(and(eq(shipments.orderId, orderId), eq(shipments.isReturn, false), eq(shipments.voided, false)))
      .orderBy(desc(shipments.id))
      .limit(20),
  ]);
  const events = order[0] ? [{
    id: -order[0].id,
    eventType: 'original_order_placed',
    status: 'placed',
    detail: null,
    actorLabel: 'System',
    eventAt: (order[0].orderDate ?? order[0].createdAt).toISOString(),
  }] : [];
  for (const shipment of outbound) {
    const shipmentAt = shipment.shipDate ?? shipment.labelCreatedAt ?? shipment.createDate;
    if (shipmentAt) events.push({
      id: -(shipment.id * 10 + 1),
      eventType: shipment.shipDate ? 'original_order_shipped' : 'original_shipment_created',
      status: shipment.shipDate ? 'shipped' : 'created',
      detail: null,
      actorLabel: 'System',
      eventAt: shipmentAt.toISOString(),
    });
    if (shipment.deliveredAt) events.push({
      id: -(shipment.id * 10 + 2),
      eventType: 'original_order_delivered',
      status: 'delivered',
      detail: null,
      actorLabel: 'System',
      eventAt: shipment.deliveredAt.toISOString(),
    });
  }
  return events.sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());
}

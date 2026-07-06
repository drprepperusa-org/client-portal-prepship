import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { shipments } from '../db/schema/shipments';
import { orders } from '../db/schema/orders';
import { returns } from '../db/schema/returns';

// ── CP-032 — Return delivery is PDF-ONLY (PrepShip label is canonical) ─────────
//
// DJ's final return decision (CP-032) SUPERSEDES the earlier CP-028 Shopify-
// native delivery path: the ONLY way a PrepShip-created return label reaches the
// customer/client is a PDF DOWNLOAD. There is no Shopify/native/storefront
// delivery and no customer/marketplace notification as part of a return — the
// shopify_native path is removed from the active flow.
//
// A return label is ALWAYS created + owned by PrepShip (CP-027, src/services/
// returns.ts → shipments.isReturn = true). This service only records the
// delivery decision/outcome (deliveryMethod = 'manual_pdf') and exposes the
// label PDF. The label/tracking/PDF SOT stays on shipments — never rewritten
// here. (The dormant Shopify-delivery env flag is no longer read by this file.)

// 'shopify_native' is retained only as a LEGACY value older persisted rows may
// still carry; the active flow only ever produces 'manual_pdf'.
export type ReturnDeliveryMethod = 'shopify_native' | 'manual_pdf';
export type ReturnDeliveryStatus = 'pending' | 'delivered' | 'failed';

/**
 * The ONLY shape a client/customer surface may see for return delivery.
 * Deliberately omits carrier / service / provider / account / raw payloads —
 * exposes just the delivery method, its status, and PDF availability + URL +
 * tracking. Mirrors the CP-027 ClientSafeReturnResult redaction contract.
 */
export type ClientSafeDeliveryResult = {
  deliveryMethod: ReturnDeliveryMethod;
  deliveryStatus: ReturnDeliveryStatus;
  pdfAvailable: boolean;
  pdfUrl: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
};

type ReturnShipmentRow = typeof shipments.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type ReturnRow = typeof returns.$inferSelect;

export type ReturnDeliveryContext = {
  /** The CP-026 returns workflow row (carries the delivery columns). */
  returnRow?: ReturnRow | null;
  /** The canonical PrepShip return shipment (shipments.isReturn = true). */
  returnShipment: ReturnShipmentRow;
  /** The order the return belongs to (kept for parity; delivery is PDF-only). */
  order: OrderRow;
};

/**
 * CP-032: delivery is ALWAYS manual_pdf. No Shopify/native path, no connector
 * call, no customer/marketplace notification. Pure decision, no side effects.
 */
export function resolveReturnDelivery(_ctx: { order: OrderRow }): { method: ReturnDeliveryMethod } {
  return { method: 'manual_pdf' };
}

/** Does the canonical return shipment have a downloadable label PDF? */
function returnPdfUrl(returnShipment: ReturnShipmentRow): string | null {
  return returnShipment.labelUrl ?? null;
}

/** Persist the delivery decision + outcome onto the CP-026 returns row. */
async function persistDeliveryOutcome(
  returnId: number | null,
  method: ReturnDeliveryMethod,
  status: ReturnDeliveryStatus,
  error: string | null,
): Promise<void> {
  if (returnId == null) return;
  try {
    await db
      .update(returns)
      .set({
        deliveryMethod: method,
        deliveryStatus: status,
        deliveryError: error,
        updatedAt: new Date(),
      })
      .where(eq(returns.id, returnId));
  } catch (err) {
    console.warn('[return-delivery] failed to persist delivery outcome:', err);
  }
}

function toClientSafe(args: {
  method: ReturnDeliveryMethod;
  status: ReturnDeliveryStatus;
  returnShipment: ReturnShipmentRow;
}): ClientSafeDeliveryResult {
  const pdfUrl = returnPdfUrl(args.returnShipment);
  return {
    deliveryMethod: args.method,
    deliveryStatus: args.status,
    // The PrepShip return label PDF is the delivery mechanism — always exposed.
    pdfAvailable: Boolean(pdfUrl),
    pdfUrl,
    trackingNumber: args.returnShipment.labelTracking ?? args.returnShipment.trackingNumber ?? null,
    trackingStatus: args.returnShipment.trackingStatus ?? null,
  };
}

/**
 * CP-032: "deliver" a return = make the PrepShip-created label PDF downloadable.
 * There is NO Shopify/native delivery, NO connector call, and NO customer or
 * marketplace notification. Returns a CLIENT-SAFE result (no carrier/service/
 * provider). Status is 'delivered' (available) when the label URL exists, else
 * 'pending'.
 */
export async function deliverReturn(ctx: ReturnDeliveryContext): Promise<ClientSafeDeliveryResult> {
  const returnId = ctx.returnRow?.id ?? null;
  const { method } = resolveReturnDelivery({ order: ctx.order }); // always manual_pdf
  const pdfUrl = returnPdfUrl(ctx.returnShipment);
  const status: ReturnDeliveryStatus = pdfUrl ? 'delivered' : 'pending';
  await persistDeliveryOutcome(returnId, method, status, null);
  return toClientSafe({ method, status, returnShipment: ctx.returnShipment });
}

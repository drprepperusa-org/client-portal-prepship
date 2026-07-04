import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../lib/env';
import { shipments } from '../db/schema/shipments';
import { orders } from '../db/schema/orders';
import { returns } from '../db/schema/returns';
import { resolveStoreConnector } from '../connectors/store-resolution';
import { inferStoreProvider } from './fulfillment/outbox';
import type { ShipmentConfirmationInput } from '../domain/fulfillment/types';

// ── CP-028 — Shopify return-delivery resolver (PrepShip label is canonical) ───
//
// A return label is ALWAYS created + owned by PrepShip (CP-027, src/services/
// returns.ts → shipments.isReturn = true). CP-028 only decides HOW that already-
// created label reaches the customer:
//
//   • shopify_native — hand the PrepShip-created label/tracking/PDF to the
//     customer THROUGH Shopify. Shopify must NOT mint its own separate label;
//     we push OUR trackingNumber/label. This path is attempted ONLY when the
//     order/store is genuinely Shopify-capable (a LIVE 'shipment.confirm' store
//     connector) AND env.RETURNS_SHOPIFY_DELIVERY is on. The Shopify store
//     connector is currently a registered STUB (implementation status
//     'registered_stub', confirmShipment returns ok:false), so in practice this
//     path degrades gracefully and falls back to manual_pdf WITHOUT losing the
//     label.
//
//   • manual_pdf — the always-available fallback. Expose the PrepShip return
//     label PDF as a download URL. No automatic email, no buyer portal (DJ:
//     PDF-download only).
//
// SAFETY: no live Shopify / customer notification may fire by default. The
// shopify_native attempt runs ONLY when env.RETURNS_SHOPIFY_DELIVERY is truthy
// AND the store resolves to a LIVE Shopify store connector. When the flag is
// off, the resolver ALWAYS returns manual_pdf and no connector is ever called.
//
// The DELIVERY decision + outcome persist onto the CP-026 returns row
// (deliveryMethod / deliveryStatus / deliveryError). The label/tracking/PDF SOT
// stays on shipments — this service never rewrites it.

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
  /** The order the return belongs to (for store/provider detection). */
  order: OrderRow;
};

/**
 * Decide whether the store is genuinely Shopify-capable for delivering OUR
 * return label. Reuses the same provider resolution the fulfillment outbox uses:
 *   1. Provider comes from orders.sourceProvider, else is inferred from the
 *      externalOrderId prefix (inferStoreProvider) — the repo's canonical
 *      order→provider mapping.
 *   2. resolveStoreConnector(..., 'shipment.confirm') returns a connector ONLY
 *      when that provider has the 'shipment.confirm' capability, and its
 *      implementation.status must be 'live' — the Shopify stub is
 *      'registered_stub', so it is NOT considered capable today. If capability
 *      can't be determined, this returns false (→ manual_pdf).
 */
export function isShopifyDeliveryCapable(order: OrderRow): boolean {
  const provider = order.sourceProvider ?? inferStoreProvider(order.externalOrderId);
  if (String(provider ?? '').trim().toLowerCase() !== 'shopify') return false;
  const resolved = resolveStoreConnector(provider, 'shipment.confirm');
  return Boolean(resolved && resolved.implementation.status === 'live');
}

/**
 * Resolve the delivery method for a return. shopify_native ONLY when the store
 * is Shopify-capable AND env.RETURNS_SHOPIFY_DELIVERY is on; otherwise
 * manual_pdf. This is a pure decision (no side effects, no connector call).
 */
export function resolveReturnDelivery(ctx: {
  order: OrderRow;
}): { method: ReturnDeliveryMethod } {
  const method: ReturnDeliveryMethod =
    env.RETURNS_SHOPIFY_DELIVERY && isShopifyDeliveryCapable(ctx.order)
      ? 'shopify_native'
      : 'manual_pdf';
  return { method };
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

/** Redaction-safe error summary — never surface raw Shopify payloads / PII. */
function safeErrorSummary(message: string | undefined): string {
  const trimmed = (message ?? '').trim();
  if (!trimmed) return 'Shopify delivery unavailable';
  // Keep it short + generic; the connector message is already non-PII (it is a
  // capability/implementation status string, not a customer/order payload).
  return trimmed.slice(0, 200);
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
    // The PrepShip return label PDF stays available regardless of delivery
    // method or a Shopify failure — never block PDF access.
    pdfAvailable: Boolean(pdfUrl),
    pdfUrl,
    trackingNumber: args.returnShipment.labelTracking ?? args.returnShipment.trackingNumber ?? null,
    trackingStatus: args.returnShipment.trackingStatus ?? null,
  };
}

/**
 * Deliver a return to the customer. Resolves the method; on shopify_native
 * (flagged + capable) attempts delivery via the store connector, pushing OUR
 * PrepShip label/tracking so Shopify never mints its own. Any failure/
 * unavailability degrades gracefully to manual_pdf, records deliveryStatus
 * 'failed' + a redaction-safe deliveryError, and ALWAYS leaves the PDF
 * available. Returns a CLIENT-SAFE result (no carrier/service/provider).
 */
export async function deliverReturn(
  ctx: ReturnDeliveryContext,
): Promise<ClientSafeDeliveryResult> {
  const returnId = ctx.returnRow?.id ?? null;
  const { method } = resolveReturnDelivery({ order: ctx.order });

  // ── manual_pdf (DEFAULT + fallback) ──
  // Reached whenever the flag is off OR the store isn't Shopify-capable. No
  // connector is ever touched here, so no live Shopify/customer notification
  // can fire. The PDF is exposed as the delivery mechanism.
  if (method === 'manual_pdf') {
    const pdfUrl = returnPdfUrl(ctx.returnShipment);
    const status: ReturnDeliveryStatus = pdfUrl ? 'delivered' : 'pending';
    await persistDeliveryOutcome(returnId, 'manual_pdf', status, null);
    return toClientSafe({ method: 'manual_pdf', status, returnShipment: ctx.returnShipment });
  }

  // ── shopify_native ──
  // Only reachable when env.RETURNS_SHOPIFY_DELIVERY is on AND the store is a
  // LIVE Shopify store connector (isShopifyDeliveryCapable). We hand OUR label/
  // tracking to Shopify via confirmShipment so it delivers the PrepShip label
  // and never mints its own. notifyCustomer/notifyMarketplace stay false by
  // default so a stub/partial path can't blast a live customer notification.
  const resolved = resolveStoreConnector(
    ctx.order.sourceProvider ?? inferStoreProvider(ctx.order.externalOrderId),
    'shipment.confirm',
  );

  // Defensive re-check: if the connector vanished between resolve and here (or
  // is not live), fall back to manual_pdf without ever calling it.
  if (!resolved || resolved.implementation.status !== 'live') {
    const error = safeErrorSummary(
      resolved
        ? `Shopify store connector is ${resolved.implementation.status}`
        : 'Shopify store connector unavailable',
    );
    await persistDeliveryOutcome(returnId, 'manual_pdf', 'failed', error);
    return toClientSafe({ method: 'manual_pdf', status: 'failed', returnShipment: ctx.returnShipment });
  }

  const confirmationInput: ShipmentConfirmationInput = {
    orderId: ctx.order.id,
    shipmentId: ctx.returnShipment.id,
    externalOrderId: ctx.order.externalOrderId,
    clientId: ctx.order.clientId,
    orderNumber: ctx.order.orderNumber,
    // Push OUR PrepShip-created return tracking — this is what makes Shopify
    // deliver the PrepShip label instead of minting a separate one.
    trackingNumber:
      ctx.returnShipment.labelTracking ?? ctx.returnShipment.trackingNumber ?? '',
    carrierCode: ctx.returnShipment.labelCarrier ?? ctx.returnShipment.carrierCode ?? null,
    shipDate: (ctx.returnShipment.labelShipDate ?? new Date()).toISOString().slice(0, 10),
    // SAFETY: no live customer/marketplace notification by default.
    notifyCustomer: false,
    notifyMarketplace: false,
  };

  try {
    const result = await resolved.connector.confirmShipment(confirmationInput);
    if (result.ok) {
      await persistDeliveryOutcome(returnId, 'shopify_native', 'delivered', null);
      return toClientSafe({
        method: 'shopify_native',
        status: 'delivered',
        returnShipment: ctx.returnShipment,
      });
    }
    // Connector reported failure (the Shopify stub always does). Degrade to
    // manual_pdf; the PDF stays available.
    const error = safeErrorSummary(result.message);
    await persistDeliveryOutcome(returnId, 'manual_pdf', 'failed', error);
    return toClientSafe({ method: 'manual_pdf', status: 'failed', returnShipment: ctx.returnShipment });
  } catch (err) {
    // Any thrown error: never lose the label. Record failure + fall back.
    const error = safeErrorSummary(err instanceof Error ? err.message : String(err));
    await persistDeliveryOutcome(returnId, 'manual_pdf', 'failed', error);
    return toClientSafe({ method: 'manual_pdf', status: 'failed', returnShipment: ctx.returnShipment });
  }
}

// Marketplace shipment-confirmation payload builders for label creation.
// Moved verbatim from services/labels.ts (B2.4). Pure functions — provider
// inference, carrier display names, tracking URLs, and the outbox payload.
import type { orders } from '../db/schema/orders';
import type { CreatedExternalLabel } from '../lib/shipstation/labels';
import { inferStoreProvider } from './fulfillment/outbox';
import { carrierNameForMarketplace, trackingUrlForCarrier } from '../lib/tracking-url';

type MarketplaceConfirmationProvider = 'shipstation' | 'walmart' | 'ebay';

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeConfirmationProvider(value: unknown): MarketplaceConfirmationProvider | null {
  const text = firstText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (!text) return null;
  if (text.includes('walmart')) return 'walmart';
  if (text.includes('ebay')) return 'ebay';
  if (text.includes('shipstation')) return 'shipstation';
  return null;
}

function stripProviderPrefix(externalOrderId: string | null | undefined, provider: string): string {
  const text = firstText(externalOrderId);
  const prefix = `${provider}-`;
  return text.toLowerCase().startsWith(prefix) ? text.slice(prefix.length) : '';
}

export function confirmationProviderForOrder(order: typeof orders.$inferSelect): MarketplaceConfirmationProvider {
  const raw = order.raw ?? {};
  const fromRaw = normalizeConfirmationProvider(
    raw.source_provider ??
    raw.sourceProvider ??
    raw.source ??
    raw.provider ??
    raw.marketplace ??
    raw.platform
  );
  if (fromRaw) return fromRaw;

  const fromExternalId = normalizeConfirmationProvider(inferStoreProvider(order.externalOrderId));
  return fromExternalId ?? 'shipstation';
}

// CP-034: carrierNameForMarketplace + trackingUrlForCarrier moved to the shared
// src/lib/tracking-url.ts so the Client Portal DTOs reuse the SAME official-URL
// logic (no duplication, no drift).

export function marketplaceConfirmationPayload(
  order: typeof orders.$inferSelect,
  created: CreatedExternalLabel,
  provider: MarketplaceConfirmationProvider,
): Record<string, unknown> {
  const raw = order.raw ?? {};
  const payload: Record<string, unknown> = {
    carrierProvider: 'shipstation',
    carrierAccountId: created.providerAccountId,
    shipStationShipmentId: created.shipmentId,
    notifyCustomer: false,
    notifyMarketplace: true,
  };

  if (provider === 'walmart') {
    payload.storeAccountId = firstText(
      raw.accountId,
      raw.storeAccountId,
      raw.sourceAccountId,
      raw.marketplaceAccountId
    ) || undefined;
    payload.purchaseOrderId = firstText(
      raw.purchaseOrderId,
      stripProviderPrefix(order.externalOrderId, 'walmart'),
      raw.orderId,
      raw.id
    ) || undefined;
    payload.rawOrder = raw;
    payload.carrierName = carrierNameForMarketplace(created.carrierCode);
    payload.trackingUrl = trackingUrlForCarrier(created.carrierCode, created.trackingNumber) || undefined;
    payload.serviceCode = created.serviceCode;
  }

  if (provider === 'ebay') {
    payload.storeAccountId = firstText(
      raw.accountId,
      raw.storeAccountId,
      raw.sourceAccountId,
      raw.marketplaceAccountId
    ) || undefined;
    payload.ebayOrderId = firstText(
      raw.orderId,
      stripProviderPrefix(order.externalOrderId, 'ebay'),
      raw.id
    ) || undefined;
    payload.rawOrder = raw;
    payload.lineItems = Array.isArray(raw.lineItems)
      ? raw.lineItems.map((line: any) => ({
          lineItemId: firstText(line?.lineItemId, line?.line_item_id),
          quantity: Number(line?.quantity ?? 1) || 1,
        })).filter((line: any) => line.lineItemId)
      : undefined;
    payload.shippingCarrierCode = carrierNameForMarketplace(created.carrierCode);
    payload.serviceCode = created.serviceCode;
  }

  return payload;
}

import type {
  ConfirmationResult,
  ShipmentConfirmationInput,
  StoreConnector,
} from '../../domain/fulfillment/types';

export function createShopifyStoreConnector(): StoreConnector {
  return {
    provider: 'shopify',
    capabilities: ['orders.import', 'orders.statusSync', 'shipment.confirm', 'inventory.import', 'inventory.push', 'products.import'],
    async confirmShipment(_input: ShipmentConfirmationInput): Promise<ConfirmationResult> {
      return {
        ok: false,
        provider: 'shopify',
        retryable: false,
        message: 'Shopify shipment confirmation connector is registered but not implemented yet',
      };
    },
  };
}

export const shopifyStoreConnector = createShopifyStoreConnector();

import { buildNormalizedOrderSource } from '../../services/normalized-order-persistence';
import { syntheticStoreIdForCredentialAccount } from '../../services/credential-accounts';
import type { NormalizedStoreOrder } from '../../services/store-order-import';

export const SHOPIFY_ADMIN_API_VERSION = '2026-04';

/**
 * Canonicalize a client-entered shop domain to `<shop>.myshopify.com`.
 * Custom storefront domains are rejected — the connect UI instructs clients to
 * use their .myshopify.com domain (the canonical identity Shopify reports).
 */
export function normalizeShopDomain(input: string): string | null {
  const trimmed = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!trimmed) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) return trimmed;
  if (/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return `${trimmed}.myshopify.com`;
  return null;
}

/**
 * Canonical status mapping (spec 2026-07-08): cancellation wins; a fully
 * fulfilled order was shipped by someone else (externallyShipped) since
 * PrepShip only imports forward from approval; everything else is actionable.
 */
export function mapShopifyOrderStatus(node: {
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
}): { orderStatus: string; externallyShipped: boolean } {
  if (node.cancelledAt) return { orderStatus: 'cancelled', externallyShipped: false };
  if ((node.displayFulfillmentStatus ?? '').toUpperCase() === 'FULFILLED') {
    return { orderStatus: 'shipped', externallyShipped: true };
  }
  return { orderStatus: 'awaiting_shipment', externallyShipped: false };
}

/** One order node from the PrepShipOrdersSince GraphQL query (2026-04). */
export type ShopifyOrderNode = {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string | null;
  email: string | null;
  shippingAddress: { name: string | null; city: string | null; provinceCode: string | null; zip: string | null } | null;
  currentTotalPriceSet: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet: { shopMoney: { amount: string } } | null;
  lineItems: {
    nodes: Array<{
      sku: string | null;
      title: string | null;
      quantity: number | null;
      originalUnitPriceSet: { shopMoney: { amount: string } } | null;
      image: { url: string | null } | null;
    }>;
  };
};

/**
 * Shopify order -> NormalizedStoreOrder for upsertNormalizedStoreOrders().
 * Returns null when the order was created before the forward-only anchor.
 * weightOz stays null in v1 — the operator fills weight before rating.
 * shippingAmount is the buyer-paid checkout total: display/record only,
 * never a Customer Shipping Rate input (CP-040).
 */
export function normalizeShopifyOrder(
  node: ShopifyOrderNode,
  ctx: { accountId: number; clientId: number | null; anchor: Date },
): NormalizedStoreOrder | null {
  const createdAt = new Date(node.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || createdAt < ctx.anchor) return null;

  const { orderStatus, externallyShipped } = mapShopifyOrderStatus(node);
  const raw = node as unknown as Record<string, unknown>;

  return {
    externalOrderId: `shopify-${node.legacyResourceId}`,
    source: buildNormalizedOrderSource({
      sourceProvider: 'shopify',
      sourceAccountId: `store-account:${ctx.accountId}`,
      sourceOrderId: node.legacyResourceId,
      sourceOrderNumber: node.name,
      raw,
    }),
    orderNumber: node.name,
    orderStatus,
    orderDate: createdAt,
    clientId: ctx.clientId,
    storeId: syntheticStoreIdForCredentialAccount('shopify', ctx.accountId),
    customerEmail: node.email ?? null,
    shipToName: node.shippingAddress?.name ?? null,
    shipToCity: node.shippingAddress?.city ?? null,
    shipToState: node.shippingAddress?.provinceCode ?? null,
    shipToPostalCode: node.shippingAddress?.zip ?? null,
    carrierCode: null,
    serviceCode: null,
    weightOz: null,
    orderTotal: node.currentTotalPriceSet?.shopMoney?.amount ?? '0',
    shippingAmount: node.totalShippingPriceSet?.shopMoney?.amount ?? '0',
    items: node.lineItems.nodes.map((li) => ({
      sku: li.sku ?? '',
      name: li.title ?? null,
      quantity: li.quantity ?? 0,
      unitPrice: li.originalUnitPriceSet?.shopMoney?.amount ?? '0',
      imageUrl: li.image?.url ?? null,
    })),
    raw,
    externallyShipped,
  };
}

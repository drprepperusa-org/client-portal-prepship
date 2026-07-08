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

import { createHash } from 'node:crypto';
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

export type ShopifyFetch = typeof fetch;

/** Schema-validated against Admin API 2026-04. Scope: read_orders. */
export const SHOP_VERIFY_QUERY = `query PrepShipShopVerify {
  shop { name myshopifyDomain }
}`;

/** Schema-validated against Admin API 2026-04. Scope: read_orders. */
export const ORDERS_SINCE_QUERY = `query PrepShipOrdersSince($first: Int!, $after: String, $search: String) {
  orders(first: $first, after: $after, query: $search, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      legacyResourceId
      name
      createdAt
      updatedAt
      cancelledAt
      displayFulfillmentStatus
      email
      shippingAddress { name city provinceCode zip }
      currentTotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      lineItems(first: 100) {
        nodes {
          sku
          title
          quantity
          originalUnitPriceSet { shopMoney { amount } }
          image { url }
        }
      }
    }
  }
}`;

type GraphqlResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'auth' | 'network' | 'throttled' | 'graphql' };

const REQUEST_TIMEOUT_MS = 8_000;
const THROTTLE_RETRY_DELAY_MS = 1_500;

async function shopifyGraphql(args: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: ShopifyFetch;
}): Promise<GraphqlResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `https://${args.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': args.accessToken,
        },
        body: JSON.stringify({ query: args.query, variables: args.variables ?? {} }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    // 401/403 = bad/revoked token; 404 = shop not found. All mean "reconnect".
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return { ok: false, reason: 'auth' };
    }
    if (!res.ok) return { ok: false, reason: 'network' };
    const json = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ extensions?: { code?: string } }>;
    };
    if (json.errors?.some((e) => e?.extensions?.code === 'THROTTLED')) {
      return { ok: false, reason: 'throttled' };
    }
    if (json.errors?.length) return { ok: false, reason: 'graphql' };
    if (!json.data) return { ok: false, reason: 'graphql' };
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * Client credentials grant (Dev Dashboard apps — Shopify retired admin-created
 * custom apps for new creation, Spring '26). Exchanges the app's Client ID +
 * Client secret for a short-lived (24h) Admin access token. Works only when
 * the app and store belong to the same Shopify organization — a failed grant
 * (wrong secret, app not installed, other org) surfaces as 'auth'.
 */
export async function exchangeShopifyClientCredentials(args: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: ShopifyFetch;
}): Promise<
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; reason: 'auth' | 'network' }
> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`https://${args.shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: args.clientId,
        client_secret: args.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status >= 400 && res.status < 500) return { ok: false, reason: 'auth' };
    if (!res.ok) return { ok: false, reason: 'network' };
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return { ok: false, reason: 'network' };
    return {
      ok: true,
      accessToken: json.access_token,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 86_399,
    };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** Stored portal credential shapes: legacy long-lived token OR client id+secret. */
export type ShopifyConnectionCredentials = {
  accessToken?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
};

// Minted client-credentials tokens live 24h; cache them per shop+client with a
// 5-minute early-refresh margin so a 3-minute poll cadence does ONE exchange a
// day per store instead of one per tick. In-memory only — never persisted.
// Each entry is FINGERPRINT-BOUND to the secret that minted it: a rotated or
// mistyped secret can never be satisfied by a token an older secret earned.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const clientCredentialTokenCache = new Map<
  string,
  { accessToken: string; expiresAt: number; secretFingerprint: string }
>();

function fingerprintSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export async function resolveShopifyAccessToken(
  credentials: ShopifyConnectionCredentials,
  shopDomain: string,
  fetchImpl?: ShopifyFetch,
  opts: { forceFresh?: boolean } = {},
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'auth' | 'network' | 'invalid_credentials' }
> {
  const legacyToken = typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
  if (legacyToken) return { ok: true, accessToken: legacyToken };

  const clientId = typeof credentials.clientId === 'string' ? credentials.clientId.trim() : '';
  const clientSecret = typeof credentials.clientSecret === 'string' ? credentials.clientSecret.trim() : '';
  if (!clientId || !clientSecret) return { ok: false, reason: 'invalid_credentials' };

  const cacheKey = `${shopDomain}|${clientId}`;
  const secretFingerprint = fingerprintSecret(clientSecret);
  if (!opts.forceFresh) {
    const cached = clientCredentialTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.secretFingerprint === secretFingerprint) {
      return { ok: true, accessToken: cached.accessToken };
    }
  }

  const exchanged = await exchangeShopifyClientCredentials({ shopDomain, clientId, clientSecret, fetchImpl });
  if (!exchanged.ok) {
    // Never leave a token minted by different/older credentials behind where
    // the next caller could be satisfied by it.
    clientCredentialTokenCache.delete(cacheKey);
    return exchanged;
  }
  clientCredentialTokenCache.set(cacheKey, {
    accessToken: exchanged.accessToken,
    expiresAt: Date.now() + exchanged.expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS,
    secretFingerprint,
  });
  return { ok: true, accessToken: exchanged.accessToken };
}

/**
 * Live credential check. Called from the portal validate endpoint AND at
 * submit time (the canonical myshopifyDomain is always derived server-side).
 * Accepts either credential mode: a legacy admin-created custom-app token
 * (accessToken) or a Dev Dashboard app's client credentials (clientId +
 * clientSecret, exchanged for a token first). Never log or persist anything
 * from here except shopName/myshopifyDomain.
 */
export async function verifyShopifyCredentials(args: {
  shopDomain: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: ShopifyFetch;
}): Promise<
  | { ok: true; shopName: string; myshopifyDomain: string }
  | { ok: false; reason: 'auth' | 'network' | 'invalid_domain' }
> {
  const domain = normalizeShopDomain(args.shopDomain);
  if (!domain) return { ok: false, reason: 'invalid_domain' };
  // forceFresh: a verification's green light must mean THIS exact secret was
  // just accepted by Shopify — never a warm cache entry (which would both
  // false-green a mistyped/rotated secret and turn the validate endpoint into
  // a shop-name oracle for anyone holding a non-secret shop+clientId pair).
  const resolved = await resolveShopifyAccessToken(
    { accessToken: args.accessToken, clientId: args.clientId, clientSecret: args.clientSecret },
    domain,
    args.fetchImpl,
    { forceFresh: true },
  );
  if (!resolved.ok) {
    // Missing/blank credentials are indistinguishable from bad ones outward.
    return { ok: false, reason: resolved.reason === 'network' ? 'network' : 'auth' };
  }
  const result = await shopifyGraphql({
    shopDomain: domain,
    accessToken: resolved.accessToken,
    query: SHOP_VERIFY_QUERY,
    fetchImpl: args.fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'auth' ? 'auth' : 'network' };
  }
  const shop = result.data.shop as { name?: string; myshopifyDomain?: string } | undefined;
  if (!shop?.myshopifyDomain) return { ok: false, reason: 'network' };
  return { ok: true, shopName: shop.name ?? shop.myshopifyDomain, myshopifyDomain: shop.myshopifyDomain };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull every order updated at/after updatedAtMin, oldest-updated first.
 * One throttle retry per page (token-bucket restore is ~50 pts/s; a single
 * short wait covers the poll cadence). Any other failure aborts the batch —
 * the caller's cursor only advances on full success, so nothing is skipped.
 */
export async function fetchShopifyOrdersSince(args: {
  shopDomain: string;
  accessToken: string;
  updatedAtMin: Date;
  pageSize?: number;
  fetchImpl?: ShopifyFetch;
}): Promise<{ ok: true; orders: ShopifyOrderNode[] } | { ok: false; reason: 'auth' | 'network' | 'throttled' | 'graphql' }> {
  const search = `updated_at:>='${args.updatedAtMin.toISOString()}'`;
  const first = args.pageSize ?? 50;
  const orders: ShopifyOrderNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < 40; page += 1) {
    let result = await shopifyGraphql({
      shopDomain: args.shopDomain,
      accessToken: args.accessToken,
      query: ORDERS_SINCE_QUERY,
      variables: { first, after, search },
      fetchImpl: args.fetchImpl,
    });
    if (!result.ok && result.reason === 'throttled') {
      await sleep(THROTTLE_RETRY_DELAY_MS);
      result = await shopifyGraphql({
        shopDomain: args.shopDomain,
        accessToken: args.accessToken,
        query: ORDERS_SINCE_QUERY,
        variables: { first, after, search },
        fetchImpl: args.fetchImpl,
      });
    }
    if (!result.ok) return { ok: false, reason: result.reason };

    const connection = result.data.orders as {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ShopifyOrderNode[];
    };
    orders.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return { ok: true, orders };
    after = connection.pageInfo.endCursor;
  }
  // 40 pages x 50 = 2000 orders in one tick — treat as done; the next tick continues.
  return { ok: true, orders };
}

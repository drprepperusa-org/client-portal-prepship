import { verifyShopifyCredentials } from '../../../connectors/store/shopify';

// One generic connect-failure message: never reveal shop-exists vs
// credentials-wrong (no token-probing oracle). Details go to server logs only.
export const SHOPIFY_CONNECT_ERROR =
  "Couldn't connect — check your shop domain and app credentials.";

type ShopifyVerificationFailure = Extract<Awaited<ReturnType<typeof verifyShopifyCredentials>>, { ok: false }>;

export function shopifyConnectError(result: ShopifyVerificationFailure): string {
  if (result.reason === 'missing_scopes') {
    return `Missing Shopify scope(s): ${result.missingScopes.join(', ')}. Update the Shopify app scopes, reinstall the app on the store, then reconnect.`;
  }
  return SHOPIFY_CONNECT_ERROR;
}

export type ShopifyCredentialInput = {
  shopDomain: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
};

// Accept a legacy Admin API token or Dev Dashboard client credentials.
export function readShopifyCredentialInput(credentials: Record<string, unknown>): ShopifyCredentialInput | null {
  const shopDomain = String(credentials['shopDomain'] ?? '').trim();
  const legacyToken = String(credentials['accessToken'] ?? '').trim();
  const clientId = String(credentials['clientId'] ?? '').trim();
  const clientSecret = String(credentials['clientSecret'] ?? '').trim();
  if (!shopDomain) return null;
  if (legacyToken) {
    const input: ShopifyCredentialInput = { shopDomain };
    input.accessToken = legacyToken;
    return input;
  }
  if (clientId && clientSecret) return { shopDomain, clientId, clientSecret };
  return null;
}

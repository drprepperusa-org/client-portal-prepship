/**
 * Store-platform catalog — ported verbatim from the real definitions in
 * client-portal-prepship/web/src/components/store-connections/storePlatforms.ts
 * (the production source of truth). 13 storefront/marketplace platforms with
 * their categories and the exact credential fields PrepShip requires.
 */

export type StorePlatformCategory = 'Direct-to-consumer' | 'Marketplaces' | 'Social commerce' | 'Retail / Wholesale';

export interface CredentialField {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
}

export interface StorePlatform {
  id: string;
  provider: string;
  aliases?: string[];
  name: string;
  category: StorePlatformCategory;
  description: string;
  accountLabel: string;
  accountPlaceholder: string;
  credentialFields: CredentialField[];
  /** Official-logo metadata (see logo reference guide). */
  logo: { slug: string | null; color: string; mono: string };
}

const keySecretFields: CredentialField[] = [
  { key: 'apiKey', label: 'API key', type: 'text', required: true },
  { key: 'apiSecret', label: 'API secret', type: 'password', required: true },
];

export const STORE_PLATFORM_CATEGORIES: StorePlatformCategory[] = [
  'Direct-to-consumer',
  'Marketplaces',
  'Social commerce',
  'Retail / Wholesale',
];

export const STORE_PLATFORMS: StorePlatform[] = [
  {
    id: 'shopify',
    provider: 'shopify',
    name: 'Shopify',
    category: 'Direct-to-consumer',
    description: 'Sync orders, inventory, and fulfillment from Shopify.',
    accountLabel: 'Shop domain',
    accountPlaceholder: 'mybrand.myshopify.com',
    credentialFields: [
      { key: 'shopDomain', label: 'Shop domain', type: 'text', required: true, placeholder: 'mybrand.myshopify.com' },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'From your app’s Settings page' },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
    ],
    logo: { slug: 'shopify', color: '#95BF47', mono: 'S' },
  },
  {
    id: 'woocommerce',
    provider: 'woocommerce',
    name: 'WooCommerce',
    category: 'Direct-to-consumer',
    description: 'Connect your WordPress + Woo storefront.',
    accountLabel: 'Store URL',
    accountPlaceholder: 'https://store.example.com',
    credentialFields: [
      { key: 'storeUrl', label: 'Store URL', type: 'url', required: true, placeholder: 'https://store.example.com' },
      { key: 'consumerKey', label: 'Consumer key', type: 'text', required: true },
      { key: 'consumerSecret', label: 'Consumer secret', type: 'password', required: true },
    ],
    logo: { slug: 'woocommerce', color: '#96588A', mono: 'W' },
  },
  {
    id: 'bigcommerce',
    provider: 'bigcommerce',
    name: 'BigCommerce',
    category: 'Direct-to-consumer',
    description: 'Pull orders and push tracking back to BigCommerce.',
    accountLabel: 'Store hash',
    accountPlaceholder: 'abc123def',
    credentialFields: [
      { key: 'storeHash', label: 'Store hash', type: 'text', required: true, placeholder: 'abc123def' },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
    logo: { slug: 'bigcommerce', color: '#121118', mono: 'B' },
  },
  {
    id: 'squarespace',
    provider: 'squarespace',
    aliases: ['squarespace_commerce'],
    name: 'Squarespace Commerce',
    category: 'Direct-to-consumer',
    description: 'Fulfillment for Squarespace stores.',
    accountLabel: 'Store name',
    accountPlaceholder: 'Squarespace store',
    credentialFields: [{ key: 'apiKey', label: 'Commerce API key', type: 'password', required: true }],
    logo: { slug: 'squarespace', color: '#000000', mono: 'Sq' },
  },
  {
    id: 'wix',
    provider: 'wix',
    name: 'Wix Stores',
    category: 'Direct-to-consumer',
    description: 'Connect your Wix eCommerce store.',
    accountLabel: 'Site ID',
    accountPlaceholder: 'Wix site ID',
    credentialFields: [
      { key: 'siteId', label: 'Site ID', type: 'text', required: true },
      { key: 'apiKey', label: 'API key', type: 'password', required: true },
    ],
    logo: { slug: 'wix', color: '#0C6EFC', mono: 'Wix' },
  },
  {
    id: 'magento',
    provider: 'magento',
    aliases: ['adobe', 'adobe_commerce', 'adobe_commerce_magento'],
    name: 'Adobe Commerce (Magento)',
    category: 'Direct-to-consumer',
    description: 'Enterprise storefront integration via REST.',
    accountLabel: 'Base URL',
    accountPlaceholder: 'https://store.example.com',
    credentialFields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, placeholder: 'https://store.example.com' },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
    logo: { slug: 'magento', color: '#EC6737', mono: 'M' },
  },
  {
    id: 'custom-api',
    provider: 'custom_api',
    name: 'Custom / API',
    category: 'Direct-to-consumer',
    description: 'Direct API, EDI, or CSV upload for any custom store.',
    accountLabel: 'Integration name',
    accountPlaceholder: 'Custom integration',
    credentialFields: keySecretFields,
    logo: { slug: null, color: '#03A9F4', mono: 'API' },
  },
  {
    id: 'amazon',
    provider: 'amazon',
    aliases: ['amazon_seller', 'amazon_seller_central'],
    name: 'Amazon Seller Central',
    category: 'Marketplaces',
    description: 'FBM orders and FBA prep workflows.',
    accountLabel: 'Seller ID',
    accountPlaceholder: 'Amazon seller ID',
    credentialFields: [
      { key: 'sellerId', label: 'Seller ID', type: 'text', required: true },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true },
    ],
    logo: { slug: 'amazon', color: '#FF9900', mono: 'a' },
  },
  {
    id: 'walmart',
    provider: 'walmart',
    aliases: ['walmart_marketplace'],
    name: 'Walmart Marketplace',
    category: 'Marketplaces',
    description: 'Add another Walmart Marketplace store.',
    accountLabel: 'Seller ID',
    accountPlaceholder: 'Walmart seller ID',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
    ],
    logo: { slug: 'walmart', color: '#0071DC', mono: 'W' },
  },
  {
    id: 'ebay',
    provider: 'ebay',
    name: 'eBay',
    category: 'Marketplaces',
    description: 'Fulfill auction and Buy-It-Now orders.',
    accountLabel: 'Seller ID',
    accountPlaceholder: 'seller username',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true },
    ],
    logo: { slug: 'ebay', color: '#E53238', mono: 'e' },
  },
  {
    id: 'etsy',
    provider: 'etsy',
    name: 'Etsy',
    category: 'Marketplaces',
    description: 'Handmade and small-batch orders with tracking.',
    accountLabel: 'Shop ID',
    accountPlaceholder: 'Etsy shop ID',
    credentialFields: keySecretFields,
    logo: { slug: 'etsy', color: '#F1641E', mono: 'E' },
  },
  {
    id: 'tiktok',
    provider: 'tiktok',
    aliases: ['tiktok_shop'],
    name: 'TikTok Shop',
    category: 'Social commerce',
    description: 'Ship orders from TikTok Shop with same-day visibility.',
    accountLabel: 'Shop cipher',
    accountPlaceholder: 'TikTok shop cipher',
    credentialFields: [
      { key: 'appKey', label: 'App key', type: 'text', required: true },
      { key: 'appSecret', label: 'App secret', type: 'password', required: true },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
    logo: { slug: 'tiktok', color: '#000000', mono: 'T' },
  },
  {
    id: 'faire',
    provider: 'faire',
    name: 'Faire',
    category: 'Retail / Wholesale',
    description: 'B2B wholesale order fulfillment for retail accounts.',
    accountLabel: 'Faire account',
    accountPlaceholder: 'Faire account name',
    credentialFields: [{ key: 'apiToken', label: 'API token', type: 'password', required: true }],
    logo: { slug: 'faire', color: '#111111', mono: 'fa' },
  },
];

export function platformsByCategory(category: StorePlatformCategory | 'all'): StorePlatform[] {
  return category === 'all' ? STORE_PLATFORMS : STORE_PLATFORMS.filter((p) => p.category === category);
}

/** Carrier brand logos (carriers aren't store platforms but still need marks). */
const CARRIER_LOGOS: Record<string, { slug: string | null; color: string; mono: string }> = {
  ups: { slug: 'ups', color: '#351C15', mono: 'UPS' },
  fedex: { slug: 'fedex', color: '#4D148C', mono: 'Fx' },
  usps: { slug: 'usps', color: '#333366', mono: 'US' },
  dhl: { slug: 'dhl', color: '#FFCC00', mono: 'DHL' },
  easypost: { slug: null, color: '#164DFF', mono: 'EP' },
  shipp: { slug: null, color: '#03A9F4', mono: 'Sh' },
  walmart_shipping: { slug: 'walmart', color: '#0071DC', mono: 'WS' },
  walmartshipping: { slug: 'walmart', color: '#0071DC', mono: 'WS' },
};

function norm(v: string | null | undefined) {
  return String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Resolve a brand logo for a connected integration (store OR carrier) from its
 * provider/label/type so connected cards show official marks too.
 */
export function resolveConnectionLogo(
  provider: string | null | undefined,
  label: string | null | undefined,
  type?: string | null,
): { slug: string | null; color: string; mono: string } {
  const p = norm(provider);
  const l = norm(label);
  const combined = `${p}_${l}`;

  // Carrier match first (so "walmart_shipping" doesn't match the Walmart store).
  if (type === 'carrier' || /carrier|shipping|easypost|easy_post|ups|fedex|usps|dhl|shipp/.test(combined)) {
    for (const key of Object.keys(CARRIER_LOGOS)) {
      if (combined.includes(key)) return CARRIER_LOGOS[key]!;
    }
    if (combined.includes('walmart')) return CARRIER_LOGOS.walmart_shipping!;
  }

  // Store platform match by id / provider / name / alias.
  const platform =
    STORE_PLATFORMS.find((sp) => norm(sp.id) === p || norm(sp.provider) === p || norm(sp.name) === l || sp.aliases?.some((a) => norm(a) === p)) ??
    STORE_PLATFORMS.find((sp) => combined.includes(norm(sp.provider)) || combined.includes(norm(sp.id)));
  if (platform) return platform.logo;

  const text = (label ?? provider ?? '?').trim().slice(0, 2).toUpperCase();
  return { slug: null, color: '#64748B', mono: text || '?' };
}

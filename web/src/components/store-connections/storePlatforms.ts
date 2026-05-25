import type { StorePlatform } from '../../types/portal';

const keySecretFields = [
  { key: 'apiKey', label: 'API key', type: 'text' as const, required: true },
  { key: 'apiSecret', label: 'API secret', type: 'password' as const, required: true },
];

export const storePlatforms: StorePlatform[] = [
  {
    id: 'shopify',
    provider: 'shopify',
    name: 'Shopify',
    category: 'Direct-to-consumer',
    description: 'Sync orders, inventory, and fulfillment from Shopify.',
    logoText: 'S',
    logoClass: 'shopify',
    accountLabel: 'Shop domain',
    accountPlaceholder: 'mybrand.myshopify.com',
    credentialFields: [
      { key: 'shopDomain', label: 'Shop domain', type: 'text', required: true },
      { key: 'accessToken', label: 'Admin API access token', type: 'password', required: true },
    ],
  },
  {
    id: 'woocommerce',
    provider: 'woocommerce',
    name: 'WooCommerce',
    category: 'Direct-to-consumer',
    description: 'Connect your WordPress + Woo storefront.',
    logoText: 'W',
    logoClass: 'woocommerce',
    accountLabel: 'Store URL',
    accountPlaceholder: 'https://store.example.com',
    credentialFields: [
      { key: 'storeUrl', label: 'Store URL', type: 'url', required: true },
      { key: 'consumerKey', label: 'Consumer key', type: 'text', required: true },
      { key: 'consumerSecret', label: 'Consumer secret', type: 'password', required: true },
    ],
  },
  {
    id: 'bigcommerce',
    provider: 'bigcommerce',
    name: 'BigCommerce',
    category: 'Direct-to-consumer',
    description: 'Pull orders and push tracking back to BigCommerce.',
    logoText: 'B',
    logoClass: 'bigcommerce',
    accountLabel: 'Store hash',
    accountPlaceholder: 'abc123def',
    credentialFields: [
      { key: 'storeHash', label: 'Store hash', type: 'text', required: true },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
  },
  {
    id: 'squarespace',
    provider: 'squarespace',
    aliases: ['squarespace_commerce'],
    name: 'Squarespace Commerce',
    category: 'Direct-to-consumer',
    description: 'Fulfillment for Squarespace stores.',
    logoText: 'Sq',
    logoClass: 'squarespace',
    accountLabel: 'Store name',
    accountPlaceholder: 'Squarespace store',
    credentialFields: [{ key: 'apiKey', label: 'Commerce API key', type: 'password', required: true }],
  },
  {
    id: 'wix',
    provider: 'wix',
    name: 'Wix Stores',
    category: 'Direct-to-consumer',
    description: 'Connect your Wix eCommerce store.',
    logoText: 'Wix',
    logoClass: 'wix',
    accountLabel: 'Site ID',
    accountPlaceholder: 'Wix site ID',
    credentialFields: [
      { key: 'siteId', label: 'Site ID', type: 'text', required: true },
      { key: 'apiKey', label: 'API key', type: 'password', required: true },
    ],
  },
  {
    id: 'magento',
    provider: 'magento',
    aliases: ['adobe', 'adobe_commerce', 'adobe_commerce_magento'],
    name: 'Adobe Commerce (Magento)',
    category: 'Direct-to-consumer',
    description: 'Enterprise storefront integration via REST.',
    logoText: 'M',
    logoClass: 'magento',
    accountLabel: 'Base URL',
    accountPlaceholder: 'https://store.example.com',
    credentialFields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', required: true },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
  },
  {
    id: 'custom-api',
    provider: 'custom_api',
    name: 'Custom / API',
    category: 'Direct-to-consumer',
    description: 'Direct API, EDI, or CSV upload for any custom store.',
    logoText: 'API',
    logoClass: 'custom',
    accountLabel: 'Integration name',
    accountPlaceholder: 'Custom integration',
    credentialFields: keySecretFields,
  },
  {
    id: 'amazon',
    provider: 'amazon',
    aliases: ['amazon_seller', 'amazon_seller_central'],
    name: 'Amazon Seller Central',
    category: 'Marketplaces',
    description: 'FBM orders and FBA prep workflows.',
    logoText: 'amz',
    logoClass: 'amazon',
    accountLabel: 'Seller ID',
    accountPlaceholder: 'Amazon seller ID',
    credentialFields: [
      { key: 'sellerId', label: 'Seller ID', type: 'text', required: true },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true },
    ],
  },
  {
    id: 'walmart',
    provider: 'walmart',
    aliases: ['walmart_marketplace', 'walmart_shipping', 'walmartshipping'],
    name: 'Walmart Marketplace',
    category: 'Marketplaces',
    description: 'Add another Walmart Marketplace store.',
    logoText: 'W',
    logoClass: 'walmart',
    accountLabel: 'Seller ID',
    accountPlaceholder: 'Walmart seller ID',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'ebay',
    provider: 'ebay',
    name: 'eBay',
    category: 'Marketplaces',
    description: 'Fulfill auction and Buy-It-Now orders.',
    logoText: 'ebay',
    logoClass: 'ebay',
    accountLabel: 'Seller ID',
    accountPlaceholder: 'seller username',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true },
    ],
  },
  {
    id: 'etsy',
    provider: 'etsy',
    name: 'Etsy',
    category: 'Marketplaces',
    description: 'Handmade and small-batch orders with tracking.',
    logoText: 'Etsy',
    logoClass: 'etsy',
    accountLabel: 'Shop ID',
    accountPlaceholder: 'Etsy shop ID',
    credentialFields: keySecretFields,
  },
  {
    id: 'tiktok',
    provider: 'tiktok',
    aliases: ['tiktok_shop'],
    name: 'TikTok Shop',
    category: 'Social commerce',
    description: 'Ship orders from TikTok Shop with same-day visibility.',
    logoText: 'T',
    logoClass: 'tiktok',
    accountLabel: 'Shop cipher',
    accountPlaceholder: 'TikTok shop cipher',
    credentialFields: [
      { key: 'appKey', label: 'App key', type: 'text', required: true },
      { key: 'appSecret', label: 'App secret', type: 'password', required: true },
      { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    ],
  },
  {
    id: 'faire',
    provider: 'faire',
    name: 'Faire',
    category: 'Retail / Wholesale',
    description: 'B2B wholesale order fulfillment for retail accounts.',
    logoText: 'faire',
    logoClass: 'faire',
    accountLabel: 'Faire account',
    accountPlaceholder: 'Faire account name',
    credentialFields: [{ key: 'apiToken', label: 'API token', type: 'password', required: true }],
  },
];

const carrierPlatforms: StorePlatform[] = [
  {
    id: 'shipp',
    provider: 'shipp',
    aliases: ['shipp_carrier'],
    name: 'Shipp Carrier',
    category: 'Direct-to-consumer',
    description: 'Connected carrier account for Shipp labels.',
    logoText: 'Shipp',
    logoClass: 'shipp',
    accountLabel: 'Account identifier',
    accountPlaceholder: 'Shipp account',
    credentialFields: keySecretFields,
  },
  {
    id: 'walmartshipping',
    provider: 'walmart_shipping',
    aliases: ['walmartshipping', 'walmart_shipping_carrier'],
    name: 'Walmart Shipping',
    category: 'Direct-to-consumer',
    description: 'Connected carrier account for Walmart Shipping labels.',
    logoText: 'Walmart',
    logoClass: 'walmartshipping',
    accountLabel: 'Account identifier',
    accountPlaceholder: 'Walmart Shipping account',
    credentialFields: keySecretFields,
  },
  {
    id: 'easypost',
    provider: 'easypost',
    aliases: ['easy_post', 'easy_post_carrier', 'easypost_carrier'],
    name: 'EasyPost Carrier',
    category: 'Direct-to-consumer',
    description: 'Connected carrier account for EasyPost labels.',
    logoText: 'EasyPost',
    logoClass: 'easypost',
    accountLabel: 'Account identifier',
    accountPlaceholder: 'EasyPost account',
    credentialFields: keySecretFields,
  },
  {
    id: 'ups',
    provider: 'ups',
    aliases: ['ups_carrier'],
    name: 'UPS Carrier',
    category: 'Direct-to-consumer',
    description: 'Connected carrier account for UPS labels.',
    logoText: 'UPS',
    logoClass: 'ups',
    accountLabel: 'Account identifier',
    accountPlaceholder: 'UPS account',
    credentialFields: keySecretFields,
  },
];

const connectionPlatforms = [...storePlatforms, ...carrierPlatforms];

export const storePlatformCategories = [
  'Direct-to-consumer',
  'Marketplaces',
  'Social commerce',
  'Retail / Wholesale',
] as const;

function normalizeProvider(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function findPlatform(providerOrId: string | null | undefined): StorePlatform {
  const value = normalizeProvider(providerOrId);
  return (
    connectionPlatforms.find(
      (platform) =>
        normalizeProvider(platform.id) === value ||
        normalizeProvider(platform.provider) === value ||
        normalizeProvider(platform.name) === value ||
        platform.aliases?.some((alias) => normalizeProvider(alias) === value),
    ) ?? storePlatforms[0]!
  );
}

export function findConnectionPlatform(provider: string | null | undefined, label: string | null | undefined): StorePlatform {
  const labelValue = normalizeProvider(label);
  const providerValue = normalizeProvider(provider);
  const combined = `${labelValue}_${providerValue}`;
  const keywordMap = [
    ['walmart_shipping', 'walmartshipping'],
    ['walmartshipping', 'walmartshipping'],
    ['walmart', 'walmart'],
    ['easy_post', 'easypost'],
    ['easypost', 'easypost'],
    ['shipp', 'shipp'],
    ['ups', 'ups'],
    ['shopify', 'shopify'],
    ['woocommerce', 'woocommerce'],
    ['bigcommerce', 'bigcommerce'],
    ['squarespace', 'squarespace'],
    ['wix', 'wix'],
    ['magento', 'magento'],
    ['adobe_commerce', 'magento'],
    ['amazon', 'amazon'],
    ['ebay', 'ebay'],
    ['etsy', 'etsy'],
    ['tiktok', 'tiktok'],
    ['faire', 'faire'],
  ] as const;

  for (const [keyword, platformId] of keywordMap) {
    if (combined.includes(keyword)) return findPlatform(platformId);
  }

  return findPlatform(provider ?? label);
}

import {
  SiBigcommerce,
  SiEbay,
  SiEtsy,
  SiShopify,
  SiSquarespace,
  SiTiktok,
  SiUps,
  SiWix,
  SiWoocommerce,
} from 'react-icons/si';
import { FaAmazon, FaMagento } from 'react-icons/fa';
import type { StorePlatform } from '../../types/portal';

type StoreLogoProps = {
  platform?: StorePlatform;
  provider?: string | null;
  label?: string | null;
  className?: string;
};

const logoAliases: Record<string, string> = {
  adobe: 'magento',
  adobe_commerce: 'magento',
  amazon_seller_central: 'amazon',
  easy_post: 'easypost',
  easy_post_carrier: 'easypost',
  easypost_carrier: 'easypost',
  shipp_carrier: 'shipp',
  shopify_plus: 'shopify',
  tiktok_shop: 'tiktok',
  ups_carrier: 'ups',
  walmart_marketplace: 'walmart',
  woo: 'woocommerce',
};

function normalizeLogoKey(value?: string | null) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveLogoKey(platform?: StorePlatform, provider?: string | null, label?: string | null) {
  const candidates = [
    provider,
    platform?.provider,
    platform?.id,
    platform?.logoClass,
    label,
    platform?.name,
    ...(platform?.aliases ?? []),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeLogoKey(candidate);
    if (!normalized) continue;
    if (logoAliases[normalized]) return logoAliases[normalized];
    if (normalized.includes('easy') && normalized.includes('post')) return 'easypost';
    if (normalized.includes('seller') && normalized.includes('amazon')) return 'amazon';
    if (normalized.includes('magento') || normalized.includes('adobe_commerce')) return 'magento';
    if (normalized.includes('tiktok')) return 'tiktok';
    if (normalized.includes('walmart')) return 'walmart';
    if (normalized.includes('shipp')) return 'shipp';
    if (normalized.includes('ups')) return 'ups';
    if (normalized in logoRenderers) return normalized;
  }

  return platform?.logoClass ?? 'custom';
}

const logoRenderers: Record<string, () => JSX.Element> = {
  amazon: () => <FaAmazon aria-hidden="true" />,
  bigcommerce: () => <SiBigcommerce aria-hidden="true" />,
  ebay: () => <SiEbay aria-hidden="true" />,
  etsy: () => <SiEtsy aria-hidden="true" />,
  magento: () => <FaMagento aria-hidden="true" />,
  shopify: () => <SiShopify aria-hidden="true" />,
  squarespace: () => <SiSquarespace aria-hidden="true" />,
  tiktok: () => <SiTiktok aria-hidden="true" />,
  ups: () => <SiUps aria-hidden="true" />,
  walmart: () => <WalmartSpark />,
  wix: () => <SiWix aria-hidden="true" />,
  woocommerce: () => <SiWoocommerce aria-hidden="true" />,
};

const wordmarkRenderers: Record<string, () => JSX.Element> = {
  custom: () => <span className="portal-platform-wordmark">API</span>,
  easypost: () => (
    <span className="portal-platform-wordmark portal-platform-wordmark-easypost">
      Easy<span>Post</span>
    </span>
  ),
  faire: () => <span className="portal-platform-wordmark portal-platform-wordmark-faire">faire</span>,
  shipp: () => <span className="portal-platform-wordmark portal-platform-wordmark-shipp">Shipp</span>,
};

export function StoreLogo({ platform, provider, label, className = '' }: StoreLogoProps) {
  const key = resolveLogoKey(platform, provider, label);
  const renderer = logoRenderers[key] ?? wordmarkRenderers[key];
  const fallback = platform?.logoText ?? String(label ?? provider ?? '?').slice(0, 4);

  return (
    <div
      className={`portal-platform-logo portal-platform-${key} ${className}`.trim()}
      aria-label={`${label ?? platform?.name ?? provider ?? 'Store'} logo`}
    >
      {renderer ? renderer() : <span className="portal-platform-wordmark">{fallback}</span>}
    </div>
  );
}

function WalmartSpark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="portal-walmart-spark">
      <g fill="currentColor">
        <rect x="28" y="3" width="8" height="25" rx="4" transform="rotate(-3 32 15.5)" />
        <rect x="28" y="36" width="8" height="25" rx="4" transform="rotate(3 32 48.5)" />
        <rect x="28" y="3" width="8" height="25" rx="4" transform="rotate(58 32 32)" />
        <rect x="28" y="3" width="8" height="25" rx="4" transform="rotate(122 32 32)" />
        <rect x="28" y="36" width="8" height="25" rx="4" transform="rotate(58 32 32)" />
        <rect x="28" y="36" width="8" height="25" rx="4" transform="rotate(122 32 32)" />
      </g>
    </svg>
  );
}

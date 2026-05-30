import type { ReactNode } from 'react';
import {
  SiShopify, SiWoocommerce, SiBigcommerce, SiSquarespace, SiWix,
  SiEbay, SiEtsy, SiTiktok, SiDhl,
} from 'react-icons/si';
import { FaAmazon, FaMagento } from 'react-icons/fa';
import type { StorePlatform } from '@/data/storePlatforms';
import EasyPostLogo from './logos/easypost';
import ShippLogo from './logos/shipp';
import WalmartLogo from './logos/walmart';
import UpsLogo from './logos/ups';
import FedexLogo from './logos/fedex';
import UspsLogo from './logos/usps';
import { cn } from '@/lib/cn';

/** Brand colors used to tint the (monochrome) react-icons marks. */
const COLORS: Record<string, string> = {
  shopify: '#95BF47', woocommerce: '#96588A', bigcommerce: '#121118', squarespace: '#121212',
  wix: '#0C6EFC', magento: '#EC6737', amazon: '#FF9900', walmart: '#0071DC', ebay: '#E53238',
  etsy: '#F1641E', tiktok: '#111111', ups: '#351C15', fedex: '#4D148C', dhl: '#D40511',
};

/** Icon renderers (react-icons + custom SVGs), keyed by resolved logo key. */
const RENDERERS: Record<string, (px: number) => ReactNode> = {
  shopify: () => <SiShopify />,
  woocommerce: () => <SiWoocommerce />,
  bigcommerce: () => <SiBigcommerce />,
  squarespace: () => <SiSquarespace />,
  wix: () => <SiWix />,
  magento: () => <FaMagento />,
  amazon: () => <FaAmazon />,
  walmart: (px) => <WalmartLogo height={px} />,
  ebay: () => <SiEbay />,
  etsy: () => <SiEtsy />,
  tiktok: () => <SiTiktok />,
  ups: (px) => <UpsLogo height={px} />,
  fedex: (px) => <FedexLogo height={Math.max(10, Math.round(px * 0.4))} />,
  usps: (px) => <UspsLogo height={Math.max(12, Math.round(px * 0.7))} />,
  dhl: () => <SiDhl />,
  easypost: (px) => <EasyPostLogo height={px} />,
  shipp: (px) => <ShippLogo height={Math.max(10, Math.round(px * 0.42))} />,
};

/** Wordmark/letter-tile fallbacks for keys with no icon. */
const FALLBACK: Record<string, { color: string; mono: string }> = {
  custom: { color: '#03A9F4', mono: 'API' },
  faire: { color: '#111111', mono: 'fa' },
};

const ALIASES: Record<string, string> = {
  adobe: 'magento', adobe_commerce: 'magento', adobe_commerce_magento: 'magento',
  amazon_seller: 'amazon', amazon_seller_central: 'amazon',
  easy_post: 'easypost', easy_post_carrier: 'easypost', easypost_carrier: 'easypost',
  walmart_shipping: 'walmart', walmartshipping: 'walmart', walmart_marketplace: 'walmart',
  shipp_carrier: 'shipp', tiktok_shop: 'tiktok', ups_carrier: 'ups',
  custom_api: 'custom', squarespace_commerce: 'squarespace', woo: 'woocommerce',
};

function norm(v: string | null | undefined) {
  return String(v ?? '').trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function resolveLogoKey(provider?: string | null, label?: string | null): string {
  for (const cand of [provider, label]) {
    const n = norm(cand);
    if (!n) continue;
    if (ALIASES[n]) return ALIASES[n];
    if (n.includes('easy') && n.includes('post')) return 'easypost';
    if (n.includes('amazon')) return 'amazon';
    if (n.includes('magento') || n.includes('adobe')) return 'magento';
    if (n.includes('tiktok')) return 'tiktok';
    if (n.includes('walmart')) return 'walmart';
    if (n.includes('shipp')) return 'shipp';
    if (n.includes('fedex')) return 'fedex';
    if (n.includes('usps') || n.includes('stamps')) return 'usps';
    if (n.includes('dhl')) return 'dhl';
    if (n.includes('ups')) return 'ups';
    if (RENDERERS[n] || FALLBACK[n]) return n;
    for (const k of Object.keys(RENDERERS)) if (n.includes(k)) return k;
  }
  return 'custom';
}

/**
 * Renders an official brand logo via bundled react-icons (no external CDN) plus
 * custom SVGs for marks react-icons lacks (EasyPost, Shipp). Falls back to a
 * brand-colored monogram tile (Custom/API, Faire, unknown).
 */
export function BrandMark({
  provider,
  label,
  name,
  size = 44,
  className,
}: {
  provider?: string | null;
  label?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const key = resolveLogoKey(provider, label ?? name);
  const render = RENDERERS[key];
  const display = name ?? label ?? provider ?? '';

  if (render) {
    const px = Math.round(size * 0.56);
    return (
      <span
        className={cn('grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/80', className)}
        style={{ width: size, height: size }}
        aria-label={`${display} logo`}
      >
        <span style={{ fontSize: px, lineHeight: 0, color: COLORS[key] ?? '#334155' }}>{render(px)}</span>
      </span>
    );
  }

  const fb = FALLBACK[key] ?? { color: '#64748B', mono: (display || '?').trim().slice(0, 2).toUpperCase() };
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-xl font-bold text-white', className)}
      style={{ width: size, height: size, background: fb.color, fontSize: size * 0.3 }}
      aria-label={`${display} logo`}
    >
      {fb.mono}
    </span>
  );
}

export function StoreLogo({ platform, size = 44, className }: { platform: StorePlatform; size?: number; className?: string }) {
  return <BrandMark provider={platform.provider} label={platform.id} name={platform.name} size={size} className={className} />;
}

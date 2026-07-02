import UpsLogo from './logos/ups';
import UspsLogo from './logos/usps';
import FedexLogo from './logos/fedex';
import ShippLogo from './logos/shipp';
import EasyPostLogo from './logos/easypost';
import WalmartLogo from './logos/walmart';
import { cn } from '@/lib/cn';

/**
 * Carrier badge — single source of truth for how a carrier renders in tables.
 * Ported from prepship-v4-stable's CarrierBadge: official SVG marks for
 * UPS / USPS / FedEx / Shipp / EasyPost / Walmart (incl. `stamps_com` → USPS),
 * and a neutral text pill for everything else (DHL, custom) — never an "API"
 * tile.
 */
type Carrier = 'ups' | 'usps' | 'fedex' | 'shipp' | 'easypost' | 'walmart' | 'other';

function classifyCarrier(code: string): Carrier {
  const l = code.toLowerCase().trim();
  if (l === 'shipp' || l.startsWith('shipp_') || l.startsWith('shipp-') || l.includes('shipp.to') || l.includes('shipp carrier')) return 'shipp';
  if (l.includes('easypost') || l.includes('easy_post') || l.includes('easy-post')) return 'easypost';
  if (l.includes('walmart')) return 'walmart';
  if (l === 'usps' || l.includes('usps') || l === 'stamps_com' || l.startsWith('stamps_com_') || l.includes('stamps')) return 'usps';
  if (l === 'ups' || l.startsWith('ups_') || l.includes('ups')) return 'ups';
  if (l.includes('fedex')) return 'fedex';
  return 'other';
}

export function formatCarrierLabel(code: string): string {
  const l = code.toLowerCase();
  if (l.includes('stamps') || l.includes('usps')) return 'USPS';
  if (l.includes('ups')) return 'UPS';
  if (l.includes('fedex')) return 'FedEx';
  if (l.includes('dhl')) return 'DHL';
  if (l.includes('walmart')) return 'Walmart';
  if (l.includes('amazon')) return 'Amazon';
  if (l.includes('ebay')) return 'eBay';
  return code.replace(/^custom_?/i, '').replace(/_/g, ' ').toUpperCase();
}

// Compact slot tuned for the orders table cell (~30% larger than the original).
const SLOT = { w: 72, h: 39 };
const H = { ups: 34, usps: 23, fedex: 16, shipp: 14, easypost: 29, walmart: 31 };

export function CarrierBadge({ code, className }: { code?: string | null; className?: string }) {
  const clean = (code ?? '').toString().trim();
  const slot = cn('inline-flex shrink-0 items-center justify-center', className);
  const style = { width: SLOT.w, height: SLOT.h };

  if (!clean) return <span className={slot} style={style} aria-hidden />;

  const carrier = classifyCarrier(clean);
  if (carrier === 'usps') return <span className={slot} style={style} title="USPS"><UspsLogo height={H.usps} /></span>;
  if (carrier === 'ups') return <span className={slot} style={style} title="UPS"><UpsLogo height={H.ups} /></span>;
  if (carrier === 'fedex') return <span className={slot} style={style} title="FedEx"><FedexLogo height={H.fedex} /></span>;
  if (carrier === 'shipp') return <span className={slot} style={style} title="Shipp"><ShippLogo height={H.shipp} /></span>;
  if (carrier === 'easypost') return <span className={slot} style={style} title="EasyPost"><EasyPostLogo height={H.easypost} /></span>;
  if (carrier === 'walmart') return <span className={slot} style={style} title="Walmart"><WalmartLogo height={H.walmart} /></span>;

  // Other (DHL, custom) → neutral pill with the carrier label.
  const label = formatCarrierLabel(clean);
  return (
    <span className={slot} style={style} title={label}>
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-3">{label}</span>
    </span>
  );
}

import { MapPin, Hash, Package, ShoppingCart } from 'lucide-react';
import { Chip } from '@/components/ui/Display';
import { Thumb } from '@/components/ui/Thumb';
import { CarrierBadge } from '@/components/store/CarrierBadge';
import { orderStatusMeta, itemCount, money, shortDate } from '@/lib/status';
import type { PortalOrder } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Weight in oz → "1 lb 5 oz". Shared by the Orders table + detail panel. */
export function fmtWeight(oz: number | null): string {
  if (oz == null || oz <= 0) return '—';
  const lb = Math.floor(oz / 16);
  const rem = Math.round((oz - lb * 16) * 10) / 10;
  if (lb && rem) return `${lb} lb ${rem} oz`;
  if (lb) return `${lb} lb`;
  return `${rem} oz`;
}

/** Pull the numeric best-rate total out of either bestRateJson shape. */
export function bestRateAmount(json: Record<string, unknown> | null | undefined): number | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  for (const k of ['shipmentCost', 'rate', 'amount', 'cost', 'totalCost', 'price', 'total']) {
    const n = Number(j[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const amt = (k: string): number => {
    const v = j[k];
    if (v && typeof v === 'object' && 'amount' in (v as Record<string, unknown>)) {
      const n = Number((v as Record<string, unknown>).amount);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };
  const ssTotal = amt('shipping_amount') + amt('other_amount') + amt('confirmation_amount');
  return ssTotal > 0 ? ssTotal : null;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <div className="flex items-center gap-1.5 text-ink-3">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function CostRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between text-sm', strong ? 'font-semibold text-ink' : 'text-ink-2')}>
      <span>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}

/** Full v4-style order detail panel — shared by Orders & Analysis drawers. */
export function OrderDetailPanel({ o }: { o: PortalOrder }) {
  const meta = orderStatusMeta(o.orderStatus);
  const best = bestRateAmount(o.bestRateJson);
  const dest = [o.shipToCity, o.shipToState].filter(Boolean).join(', ') || '—';
  const service = o.shippingService ?? o.serviceCode ?? null;
  const lineTotal = (it: PortalOrder['items'][number]) => {
    const p = Number((it as { unitPrice?: number | string | null }).unitPrice);
    return Number.isFinite(p) ? p * (Number(it.quantity) || 1) : null;
  };
  const subtotal = o.items.reduce((n, it) => n + (lineTotal(it) ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Chip accent={meta.accent}>{meta.label}</Chip>
        <span className="text-sm text-ink-3">{shortDate(o.orderDate)}</span>
      </div>

      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><MapPin size={13} /> Ship to</p>
        <p className="text-sm font-semibold text-ink">{o.shipToName ?? '—'}</p>
        <p className="text-sm text-ink-2">{dest}</p>
        {o.clientName && <p className="mt-1 text-xs text-ink-3">{o.clientName}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3"><Hash size={14} /> Carrier</p>
          <div className="mt-1 flex items-center gap-2">
            {o.carrierCode ? <CarrierBadge code={o.carrierCode} /> : <span className="text-sm text-ink-3">—</span>}
          </div>
        </div>
        <Detail icon={<Package size={14} />} label="Service" value={service ?? '—'} />
        <Detail icon={<ShoppingCart size={14} />} label="Shipping account" value={o.shippingAccount ?? '—'} />
        <Detail icon={<Package size={14} />} label="Weight" value={fmtWeight(o.weightOz)} />
      </div>

      {(o.orderTotal != null || subtotal > 0 || best != null || o.shippingAmount != null) && (
        <div className="space-y-2 rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Cost summary</p>
          {subtotal > 0 && <CostRow label="Product subtotal" value={money(subtotal)} />}
          {o.shippingAmount != null && Number(o.shippingAmount) > 0 && <CostRow label="Shipping charged" value={money(o.shippingAmount)} />}
          {best != null && <CostRow label="Best rate" value={money(best)} />}
          {o.orderTotal != null && (
            <>
              <div className="my-1 border-t border-slate-200/70" />
              <CostRow label="Order total" value={money(o.orderTotal)} strong />
            </>
          )}
        </div>
      )}

      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Items ({itemCount(o.items)})</p>
        <ul className="space-y-3">
          {o.items.length === 0 && <li className="text-sm text-ink-3">No line items.</li>}
          {o.items.map((it, i) => {
            const lt = lineTotal(it);
            return (
              <li key={i} className="flex items-center gap-3">
                <Thumb src={it.imageUrl} alt={it.name ?? ''} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink" title={it.name ?? ''}>{it.name ?? it.sku ?? 'Item'}</p>
                  {it.sku && <p className="truncate font-mono text-[11px] text-ink-3">{it.sku}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm tnum text-ink-2">×{it.quantity ?? 1}</p>
                  {lt != null && <p className="text-xs tnum text-ink-3">{money(lt)}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {o.trackingNumber && (
        <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <p className="text-xs text-ink-3">Tracking number</p>
          <p className="truncate font-mono text-sm text-ink">{o.trackingNumber}</p>
        </div>
      )}
    </div>
  );
}

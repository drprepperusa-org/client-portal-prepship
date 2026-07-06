import { MapPin, Package, Truck } from 'lucide-react';
import { Chip } from '@/components/ui/Display';
import { Thumb } from '@/components/ui/Thumb';
import { orderStatusMeta, itemCount, money, shortDate } from '@/lib/status';
import type { PortalOrder } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Weight in oz → "1 lb 5 oz". Shared by the Orders table + detail panel. */
export function fmtWeight(oz: number | null): string {
  if (oz == null || oz <= 0) return '—';
  let lb = Math.floor(oz / 16);
  let rem = Math.round((oz - lb * 16) * 10) / 10;
  if (rem >= 16) { lb += 1; rem = 0; } // carry when the oz remainder rounds up to a full pound
  if (lb && rem) return `${lb} lb ${rem} oz`;
  if (lb) return `${lb} lb`;
  return `${rem} oz`;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <div className="flex items-center gap-1.5 text-ink-3">
        {icon}
        <span className="truncate text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
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
export function OrderDetailPanel({ o, hideWeight = false }: { o: PortalOrder; hideWeight?: boolean }) {
  const meta = orderStatusMeta(o.orderStatus);
  // CP-018: this is a CUSTOMER-facing page — it shows the customer shipping rate
  // only (backend-owned: billed customer shipping, fallback buyer-paid store
  // shipping), never the internal selected/best/label rate, carrier, or service.
  // The > 0 guard treats a '0.00' billed value as "not billed yet".
  const shipping = [o.customerShippingRate]
    .map((value) => (value == null ? NaN : Number(value)))
    .find((n) => Number.isFinite(n) && n > 0);
  // CP-014/CP-017: per-line totals and the cost-summary rows are backend-owned
  // money. The panel renders o.costSummary verbatim and does no receipt math.
  const lineTotal = (it: PortalOrder['items'][number]): number | null => {
    const t = Number(it.lineTotal);
    return Number.isFinite(t) ? t : null;
  };
  // Full customer ship-to address ("Boston, MA 02101").
  const cityLine = [[o.shipToCity, o.shipToState].filter(Boolean).join(', '), o.shipToPostalCode]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Chip accent={meta.accent}>{meta.label}</Chip>
        <span className="truncate text-sm text-ink-3">
          {o.orderNumber ? `#${o.orderNumber} · ` : ''}{shortDate(o.orderDate)}
        </span>
      </div>

      {/* Full customer ship-to address */}
      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><MapPin size={13} /> Ship to</p>
        <p className="break-words text-sm font-semibold text-ink">{o.shipToName ?? '—'}</p>
        {o.shipToLine1 && <p className="break-words text-sm text-ink-2">{o.shipToLine1}</p>}
        {o.shipToLine2 && <p className="break-words text-sm text-ink-2">{o.shipToLine2}</p>}
        {cityLine && <p className="break-words text-sm text-ink-2">{cityLine}</p>}
        {o.shipToCountry && <p className="break-words text-sm text-ink-2">{o.shipToCountry}</p>}
        {o.clientName && <p className="mt-1 break-words text-xs text-ink-3">{o.clientName}</p>}
      </div>

      {/* CP-009: shipping AMOUNT + optional weight only — never carrier or service. */}
      <div className={cn('grid gap-3', hideWeight ? 'grid-cols-1' : 'grid-cols-2')}>
        <Detail icon={<Truck size={14} />} label="Customer Shipping Rate" value={shipping != null ? money(shipping) : '—'} />
        {!hideWeight && <Detail icon={<Package size={14} />} label="Weight" value={fmtWeight(o.weightOz)} />}
      </div>

      {o.costSummary && o.costSummary.length > 0 && (
        <div className="space-y-2 rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Cost summary</p>
          {/* CP-017: backend-owned rows rendered verbatim — the panel does no
              receipt math. Non-total rows (subtotal, discount, shipping, tax,
              refund/adjustment), then a divider + the bold Order total. Negative
              amounts render as -$X.XX via money(). */}
          {o.costSummary.filter((r) => r.kind !== 'total').map((r, i) => (
            <CostRow key={i} label={r.label} value={money(r.amount)} />
          ))}
          {o.costSummary.filter((r) => r.kind === 'total').map((r, i) => (
            <div key={`t-${i}`}>
              <div className="my-1 border-t border-slate-200/70" />
              <CostRow label={r.label} value={money(r.amount)} strong />
            </div>
          ))}
        </div>
      )}

      {/* Full order — every line item */}
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

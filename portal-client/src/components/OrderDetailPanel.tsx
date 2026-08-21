import { MapPin, Truck, ExternalLink } from 'lucide-react';
import { Chip } from '@/components/ui/Display';
import { Thumb } from '@/components/ui/Thumb';
import { orderStatusMeta, money, shortDate } from '@/lib/status';
import type { PortalOrder } from '@/lib/api';
import { cn } from '@/lib/cn';

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
export function OrderDetailPanel({ o }: { o: PortalOrder }) {
  const meta = orderStatusMeta(o.orderStatus);
  // CP-018: this is a CUSTOMER-facing page — it shows the customer shipping rate
  // only (backend-owned: billed customer shipping, fallback buyer-paid store
  // shipping), never the internal selected/best/label rate, carrier, or service.
  // The > 0 guard treats a '0.00' billed value as "not billed yet".
  const shipping = [o.customerShippingRate]
    .map((value) => (value == null ? NaN : Number(value)))
    .find((n) => Number.isFinite(n) && n > 0);
  // CP-014/CP-017: per-line totals and the cost-summary rows are backend-owned
  // money. The panel renders o.chargeSummary verbatim and does no receipt math.
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
        <span className="flex items-center gap-2">
          <Chip accent={meta.accent}>{meta.label}</Chip>
          {/* CP-061: backend-derived REPLACE badge — rendered from
              hasActiveReplacement only, never re-derived in the client. */}
          {o.hasActiveReplacement && <Chip accent="emerald" dot={false}>REPLACE</Chip>}
        </span>
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

      {/* CP-009: shipping AMOUNT only — never carrier, service, provider, or package measurements. */}
      <div className="grid gap-3">
        <Detail icon={<Truck size={14} />} label="Customer Shipping Rate" value={shipping != null ? money(shipping) : '—'} />
      </div>

      {o.chargeSummary && o.chargeSummary.length > 0 && (
        <div className="space-y-2 rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Order charges</p>
          {/* CP-017: backend-owned rows rendered verbatim — the panel does no
              receipt math. Non-total rows (subtotal, discount, shipping, tax,
              refund/adjustment), then a divider + the bold Order total. Negative
              amounts render as -$X.XX via money(). */}
          {o.chargeSummary.filter((r) => r.kind !== 'total').map((r, i) => (
            <CostRow key={i} label={r.label} value={money(r.amount)} />
          ))}
          {o.chargeSummary.filter((r) => r.kind === 'total').map((r, i) => (
            <div key={`t-${i}`}>
              <div className="my-1 border-t border-slate-200/70" />
              <CostRow label={r.label} value={money(r.amount)} strong />
            </div>
          ))}
        </div>
      )}

      {/* Full order — every line item */}
      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Items ({o.orderedUnits})</p>
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
                  <p className="text-sm tnum text-ink-2">×{it.quantity}</p>
                  {lt != null && <p className="text-xs tnum text-ink-3">{money(lt)}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {o.displayTrackingNumber && (
        <div className="rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
          <p className="text-xs text-ink-3">Tracking number</p>
          {o.trackingUrl ? (
            <a
              href={o.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex max-w-full items-center gap-1.5 font-mono text-sm font-medium text-brand-700 underline decoration-dotted decoration-brand-300 underline-offset-2 hover:text-brand-800"
            >
              <span className="truncate">{o.displayTrackingNumber}</span>
              <ExternalLink size={13} className="shrink-0" />
            </a>
          ) : (
            <p className="truncate font-mono text-sm text-ink">{o.displayTrackingNumber}</p>
          )}
        </div>
      )}
    </div>
  );
}

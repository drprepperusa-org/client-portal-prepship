import { money } from '@/lib/status';
import { cn } from '@/lib/cn';

/**
 * Customer Shipping Rate cell — shared by the Orders + Shipments tables.
 *
 * - a billed rate (> 0)      → the money amount.
 * - pending (backend flag)   → a muted "Pending" chip, so a shipped-but-not-yet-
 *                              billed charge doesn't read as "no shipping".
 * - otherwise                → "—".
 *
 * The frontend never decides WHEN it is pending — that is the backend-owned
 * `customerShippingRatePending` flag (see src/lib/client-portal/dto.ts). This
 * cell only renders it, and it never shows an invented amount.
 */
export function ShippingRateCell({
  rate,
  pending = false,
  moneyClassName = 'text-ink',
}: {
  rate: number | string | null | undefined;
  pending?: boolean;
  moneyClassName?: string;
}) {
  const amount = Number(rate);
  if (Number.isFinite(amount) && amount > 0) {
    return <span className={cn('font-semibold tnum', moneyClassName)}>{money(amount)}</span>;
  }
  if (pending) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600 ring-1 ring-amber-200"
        title="Shipping is billed after the order is invoiced — the charge will appear here then."
      >
        Pending
      </span>
    );
  }
  return <span className="text-xs text-ink-3">—</span>;
}

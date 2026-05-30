import type { Accent } from './accents';
import type { PortalShipment } from './api';

/** Pretty label + accent for a raw backend order_status. */
export function orderStatusMeta(status: string | null): { label: string; accent: Accent } {
  switch ((status ?? '').toLowerCase()) {
    case 'awaiting_shipment':
      return { label: 'Awaiting Shipment', accent: 'amber' };
    case 'shipped':
      return { label: 'Shipped', accent: 'sky' };
    case 'delivered':
      return { label: 'Delivered', accent: 'emerald' };
    case 'cancelled':
    case 'canceled':
      return { label: 'Cancelled', accent: 'rose' };
    case 'on_hold':
    case 'pending':
      return { label: 'Pending', accent: 'violet' };
    default:
      return { label: status ? prettify(status) : 'Unknown', accent: 'indigo' };
  }
}

/** Derive a display status for a shipment (the DTO has no explicit status). */
export function shipmentStatusMeta(s: PortalShipment): { label: string; accent: Accent } {
  if (s.voided) return { label: 'Voided', accent: 'rose' };
  if (s.trackingNumber || s.labelTracking) return { label: 'In Transit', accent: 'sky' };
  return { label: 'Label Created', accent: 'violet' };
}

function prettify(s: string) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Sum item quantities, falling back to item count. */
export function itemCount(items: Array<{ quantity: number | null }>): number {
  if (!items?.length) return 0;
  const sum = items.reduce((n, it) => n + (Number(it.quantity) || 0), 0);
  return sum > 0 ? sum : items.length;
}

export function money(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '$0.00';
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

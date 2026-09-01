import type { Accent } from './accents';

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

/** Presentation-only mapping for the backend-owned shipmentStatus enum. */
export function shipmentStatusMeta(status: string | null | undefined): { label: string; accent: Accent } {
  switch (status) {
    case 'voided':
      return { label: 'Voided', accent: 'rose' };
    case 'delivered':
      return { label: 'Delivered', accent: 'emerald' };
    case 'exception':
      return { label: 'Exception', accent: 'amber' };
    case 'attempted':
      return { label: 'Attempted', accent: 'amber' };
    case 'in_transit':
      return { label: 'In Transit', accent: 'sky' };
    case 'label_created':
      return { label: 'Label Created', accent: 'violet' };
    default:
      return { label: 'Unavailable', accent: 'indigo' };
  }
}

function prettify(s: string) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
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

// CP-063: format a day-granular value (a YYYY-MM-DD calendar day, e.g. a backend billing day)
// WITHOUT a timezone shifting it. shortDate() parses a day as UTC midnight, so a local formatter
// renders the previous day in Western-hemisphere zones; anchoring to LOCAL midnight of the exact
// day keeps the rendered date the same calendar day in any timezone.
export function shortDay(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

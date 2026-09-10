import type { Accent } from './accents';
import type { PortalOrderFulfillmentStatus } from '@client-portal-contracts/orders';
import type { PortalShipmentStatus } from '@client-portal-contracts/shipments';

/**
 * Pretty label + accent for a raw backend order_status (PrepShip's own field:
 * awaiting_shipment | shipped | cancelled | on_hold). Presentation only — the outbound
 * fulfillment badge is `fulfillmentStatusMeta` below; this map exists for surfaces that show
 * the raw marketplace status (Analysis SKU orders). It never renders carrier progress.
 */
export function orderStatusMeta(status: string | null): { label: string; accent: Accent } {
  switch ((status ?? '').toLowerCase()) {
    case 'awaiting_shipment':
      return { label: 'Awaiting Shipment', accent: 'amber' };
    case 'shipped':
      return { label: 'Shipped', accent: 'sky' };
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

/**
 * CP-069 — the ONE presentation map for the backend-owned order fulfillment status
 * (PortalOrder.fulfillmentStatus). Shared by the Orders table badge and the order detail
 * panel; the frontend never derives the value. Labels are PrepShip's own vocabulary
 * (Awaiting / Shipped / Cancelled) plus Voided — never "In Transit" or "Delivered".
 *
 * TRANSITIONAL (remove after every client has reloaded onto the CP-069 bundle): a pre-CP-069
 * API may still send in_transit / delivered for a few minutes during the independent Vercel /
 * Render deploys; both meant "the order shipped", so they render as Shipped rather than
 * falling through to the pending badge.
 */
const FULFILLMENT_STATUS_META: Record<PortalOrderFulfillmentStatus, { label: string; accent: Accent }> = {
  pending: { label: 'Awaiting shipment', accent: 'amber' },
  shipped: { label: 'Shipped', accent: 'sky' },
  cancelled: { label: 'Cancelled', accent: 'rose' },
  voided: { label: 'Voided', accent: 'indigo' },
};

const LEGACY_FULFILLMENT_KEYS: Readonly<Record<string, PortalOrderFulfillmentStatus>> = {
  in_transit: 'shipped',
  delivered: 'shipped',
};

export function fulfillmentStatusMeta(status: PortalOrderFulfillmentStatus | string | null | undefined): { label: string; accent: Accent } {
  const key = (status && status in FULFILLMENT_STATUS_META ? status : LEGACY_FULFILLMENT_KEYS[status ?? ''] ?? 'pending') as PortalOrderFulfillmentStatus;
  return FULFILLMENT_STATUS_META[key];
}

/**
 * CP-069 — presentation-only mapping for the backend-owned outbound shipmentStatus enum
 * (PortalShipment.shipmentStatus): shipped | label_created | cancelled | voided | unavailable.
 * Unknown values fail closed to "Unavailable".
 *
 * TRANSITIONAL (same removal note as above): the pre-CP-069 carrier vocabulary
 * (in_transit / delivered / exception / attempted) all meant "the parcel shipped" and renders
 * as Shipped until the old API is gone.
 */
const SHIPMENT_STATUS_META: Record<PortalShipmentStatus, { label: string; accent: Accent }> = {
  shipped: { label: 'Shipped', accent: 'sky' },
  label_created: { label: 'Label Created', accent: 'violet' },
  cancelled: { label: 'Cancelled', accent: 'rose' },
  voided: { label: 'Voided', accent: 'rose' },
  unavailable: { label: 'Unavailable', accent: 'indigo' },
};

const LEGACY_SHIPMENT_KEYS: Readonly<Record<string, PortalShipmentStatus>> = {
  in_transit: 'shipped',
  delivered: 'shipped',
  exception: 'shipped',
  attempted: 'shipped',
};

export function shipmentStatusMeta(status: PortalShipmentStatus | string | null | undefined): { label: string; accent: Accent } {
  const key = (status && status in SHIPMENT_STATUS_META ? status : LEGACY_SHIPMENT_KEYS[status ?? ''] ?? 'unavailable') as PortalShipmentStatus;
  return SHIPMENT_STATUS_META[key];
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

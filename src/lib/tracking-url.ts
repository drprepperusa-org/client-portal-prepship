// CP-034 — canonical carrier tracking-URL builder.
//
// Shared by the marketplace shipment-confirmation payloads
// (services/labels-confirmation.ts) AND the Client Portal DTOs, so a tracking
// link opens the REAL carrier site (USPS / UPS / FedEx) — never a generic
// third-party tracker (17track). Carrier IDENTITY is still never exposed to the
// portal (carrierCode/serviceCode stay redacted); only this URL, whose
// destination happens to be carrier-specific, crosses the wire — per DJ's CP-034
// correction to the earlier CP-009/CP-018 neutral-link rule.

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Normalize a carrier code/alias (usps/stamps_com, ups, fedex/fedex_ground) to
 *  a display carrier name. Returns 'Other' when unrecognized. */
export function carrierNameForMarketplace(carrierCode: string | null | undefined): string {
  const code = firstText(carrierCode).toLowerCase();
  if (code.includes('fedex')) return 'FedEx';
  if (code.includes('ups')) return 'UPS';
  if (code.includes('usps') || code.includes('stamps')) return 'USPS';
  return firstText(carrierCode, 'Other');
}

/**
 * Official carrier tracking URL for a (carrier, tracking) pair:
 *  - FedEx → https://www.fedex.com/fedextrack/?trknbr=…
 *  - UPS   → https://www.ups.com/track?tracknum=…
 *  - USPS (incl. stamps_com) → https://tools.usps.com/go/TrackConfirmAction?tLabels=…
 *
 * Returns '' for an unknown carrier or missing tracking — NEVER a generic
 * third-party tracker, and never null. Callers treat '' as "no safe link"
 * (render the tracking number as copyable text instead).
 */
export function trackingUrlForCarrier(
  carrierCode: string | null | undefined,
  trackingNumber: string | null | undefined,
): string {
  const tracking = firstText(trackingNumber);
  if (!tracking) return '';
  const carrier = carrierNameForMarketplace(carrierCode).toLowerCase();
  if (carrier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`;
  if (carrier === 'ups') return `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`;
  if (carrier === 'usps') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`;
  return '';
}

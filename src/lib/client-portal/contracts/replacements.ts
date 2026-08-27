// CP-061 — customer-safe Replace contracts. The portal renders canonical
// PS-502 replacement truth and decides none of it.
//
// Source: shared-DB `replacements` / `replacement_items` rows (see the
// read-only mirror in src/db/schema/replacements.ts). Event clock:
// `requestedAt` is the canonical replacements.requested_at. Redaction:
// operator/internal fields (review, admin override, idempotency, signature,
// fingerprint, liability, billable) are not mirrored and never cross;
// `reason` is the customer-safe request reason. No carrier/service/provider
// or money identity exists on this surface.

import type { PortalReplacementReasonCode } from '../replacement-reason';

/** Canonical PS-502 lifecycle vocabulary (prepship-v4 replacement-state-machine.ts). */
export type PortalReplacementStatus =
  | 'requested'
  | 'review'
  | 'approved'
  | 'label_created'
  | 'label_failed'
  | 'shipped'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface PortalReplacementRow {
  id: number;
  /** Allocated canonical reference, e.g. `1321-REPLACE`, `1321-REPLACE-2`. */
  reference: string;
  orderId: number;
  orderNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  status: PortalReplacementStatus | string;
  // `reason` is surfaced as a canonical CODE only — never the raw stored value.
  //
  // PS-502 froze a four-value vocabulary — damaged | wrong_item | lost_in_transit
  // | other (prepship-v4 replacement-create-command.ts:59). Disclosure was
  // previously WITHHELD because the column is bare `reason text not null`
  // (drizzle/0096_ps502_replacements.sql:35) and PrepShip published no labels, so
  // asserting a label here would have been our own unsourced claim.
  //
  // PS-502 now publishes a versioned code/label contract
  // (GET /replacements/reason-contract, `replacement-request-v1`). So the portal
  // exposes the canonical CODE here — redacted to null by `toReasonCode` whenever
  // the stored value is not one of the four, so raw free text never crosses — and
  // the frontend renders the LABEL from the fetched contract, keeping NO local
  // code->label map (DJ 2026-08-12: a customer-safe label, never raw).
  reasonCode: PortalReplacementReasonCode | null;
  /** Count of replacement_items lines. */
  itemCount: number;
  requestedAt: string | null;
}

export interface PortalReplacementItem {
  id: number;
  sku: string;
  name: string | null;
  quantity: number;
}

export interface PortalReplacementDetail extends PortalReplacementRow {
  items: PortalReplacementItem[];
}

/** Backend-derived order badge fields (CP-061). The frontend renders these
 * verbatim and never re-derives them from replacement rows. */
export interface OrderReplacementBadge {
  hasActiveReplacement: boolean;
  activeReplacementStatus: string | null;
  activeReplacementCount: number;
  activeReplacementReference: string | null;
}

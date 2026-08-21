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
  /** Customer-safe request reason (operator notes are internal and absent). */
  reason: string;
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
  replacementStatus: string | null;
  replacementCount: number;
  replacementReference: string | null;
}

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
  // `reason` is deliberately NOT exposed.
  //
  // PS-502 froze a four-value vocabulary for it — damaged | wrong_item |
  // lost_in_transit | other (prepship-v4 replacement-create-command.ts:59) —
  // but that is a SERVICE-LAYER invariant. Stated precisely (Hermes, 2026-08-22):
  // the HTTP transport validator accepts any trimmed non-empty text, while the
  // canonical create command DOES enforce the four-code vocabulary and rejects
  // anything else with REPLACEMENT_REASON_INVALID
  // (replacement-create-command.ts:195-201). What is missing is not enforcement
  // — it is DISCLOSURE: database storage is bare `reason text not null` with no
  // CHECK (drizzle/0096_ps502_replacements.sql:35), upstream has never declared
  // the value customer-safe, and it ships no display labels for the four codes.
  //
  // This contract previously asserted "customer-safe request reason". PrepShip
  // never said that, so it was OUR claim rather than a rendered truth — the
  // unsourced business truth the shadow-renderer law forbids. Withholding until
  // PS-502 constrains the column and states the disclosure is the honest
  // position; upstream's own customer-adjacent return read model omits
  // `returns.reason` in the same way.
  //
  // INTERIM, NOT FINAL. DJ's 2026-08-12 CP-061 decision requires this to surface
  // as a customer-safe label — Damaged / Wrong item / Lost in transit / Other —
  // never raw free text. Withholding satisfies "never raw" while the upstream
  // disclosure contract is missing, but it must NOT quietly become the permanent
  // answer: closing CP-061 needs either PS-502 to publish a constrained
  // code/label contract (then a narrow rendering change here), or DJ to change
  // that visibility decision. Restoring the raw column is not an option.
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

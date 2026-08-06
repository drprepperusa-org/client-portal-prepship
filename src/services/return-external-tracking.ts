// CP-058 AC-3/AC-4 — assigning an EXTERNALLY purchased return label.
//
// Pure. Decides whether a return may accept external tracking and what gets recorded.
// It performs no write and calls no provider, so the rule is testable offline and the
// "never buys postage" guarantee is structural rather than a promise in a comment.
//
// The constraint that shapes this module is AC-4's "one canonical active label/tracking
// state rather than competing PrepShip and external truths". A return already has ONE
// owner of that state — returns.return_shipment_id, written by the PrepShip label path.
// So this is not a second writer: it refuses whenever that slot is already filled, and
// the label path refuses whenever this one filled it.

/** Statuses that can still accept a label — PrepShip-bought or external. */
const LABELABLE_STATUSES = new Set(['requested', 'label_failed']);

export type ExternalTrackingRejection =
  | 'tracking_required'
  // The client-facing name is amountPaid: the internal cost vocabulary is forbidden
  // in customer bundles, and this code travels to the portal in the error body.
  | 'amount_paid_required'
  | 'label_already_exists'
  | 'status_not_labelable';

export type ExternalTrackingDecision =
  | { kind: 'rejected'; code: ExternalTrackingRejection; message: string }
  | {
      kind: 'accept';
      trackingNumber: string;
      /** Operator-entered cost of the label they bought elsewhere. */
      externalLabelCost: number;
    };

export function resolveReturnExternalTracking(input: {
  return: {
    status: string;
    /** Non-null means a label already owns this return's tracking state. */
    returnShipmentId: number | null;
  };
  trackingNumber: unknown;
  /** What the client paid a carrier directly. Client-facing name; see the rejection type. */
  amountPaid: unknown;
}): ExternalTrackingDecision {
  // Competing-truths check FIRST. A return that already has a PrepShip label must not
  // gain a second, external one — whichever arrived first stays canonical.
  if (input.return.returnShipmentId != null) {
    return {
      kind: 'rejected',
      code: 'label_already_exists',
      message: 'This return already has a label. Void it before assigning external tracking.',
    };
  }
  if (!LABELABLE_STATUSES.has(input.return.status)) {
    return {
      kind: 'rejected',
      code: 'status_not_labelable',
      message: `A return at status "${input.return.status}" can no longer take a label.`,
    };
  }

  const trackingNumber = typeof input.trackingNumber === 'string' ? input.trackingNumber.trim() : '';
  if (!trackingNumber) {
    return {
      kind: 'rejected',
      code: 'tracking_required',
      message: 'A tracking number is required.',
    };
  }

  // AC-3 requires the cost. It is accepted so the 3PL can reconcile what the label
  // actually cost — NOT so it can become what the client is charged. A configured $0.00
  // is a real answer ("the label was free"), so only a missing or nonsensical value is
  // refused.
  const amountPaid = input.amountPaid === '' || input.amountPaid == null
    ? Number.NaN
    : Number(input.amountPaid);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) {
    return {
      kind: 'rejected',
      code: 'amount_paid_required',
      message: 'An amount paid is required (use 0 if the label was free).',
    };
  }


  return { kind: 'accept', trackingNumber, externalLabelCost: amountPaid };
}

/**
 * The shipment fields an accepted external assignment may write.
 *
 * Deliberately NARROW. It carries no provider identity of any kind — no
 * providerAccountId, labelProvider, shipstationLabelId or labelProviderKey — because
 * nothing was purchased through a provider, and a populated provider field would make a
 * hand-entered tracking number look like a PrepShip purchase to every downstream reader.
 *
 * It also never returns a customer-facing rate. returns.return_customer_shipping_rate is
 * the client-billed amount and is owned by PrepShip's configured charge (PS-487 AC-2 /
 * PS-435): letting an operator-entered cost flow into it is exactly the substitution
 * those guards exist to prevent.
 */
export function externalTrackingShipmentFields(decision: {
  kind: 'accept';
  trackingNumber: string;
  externalLabelCost: number;
}): {
  isReturn: true;
  trackingNumber: string;
  labelTracking: string;
  cost: string;
  source: 'external_return_label';
  voided: false;
} {
  const cost = decision.externalLabelCost.toFixed(2);
  return {
    isReturn: true,
    trackingNumber: decision.trackingNumber,
    labelTracking: decision.trackingNumber,
    cost,
    source: 'external_return_label',
    voided: false,
  };
}

/** Status a return moves to once external tracking is recorded. */
export const EXTERNAL_TRACKING_RETURN_STATUS = 'label_created';
/** Append-only activity event type. */
export const EXTERNAL_TRACKING_EVENT = 'external_tracking_assigned';

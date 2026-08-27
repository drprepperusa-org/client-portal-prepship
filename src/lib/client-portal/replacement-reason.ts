// CP-061 — the customer-safe replacement reason boundary.
//
// The portal knows the canonical reason CODE set (the PS-502 request enum) so it can redact any
// non-canonical / raw stored reason before it crosses the customer boundary, and it validates
// the PS-502 reason-contract before trusting its labels. It keeps NO local code->label MAP:
// labels come only from the contract PrepShip publishes (DJ 2026-08-12; PS-502 endpoint
// GET /replacements/reason-contract, version `replacement-request-v1`). If the upstream vocabulary
// or version ever drifts, `validateReasonContract` returns null and the surface fails CLOSED
// rather than inventing a label.

/** The canonical reason codes — the API enum, NOT a label map. Used to redact raw reasons and to
 *  verify a fetched contract carries exactly this set. Mirrors prepship-v4 REPLACEMENT_REASONS;
 *  a drift is caught at runtime because a contract missing/adding a code fails validation. */
export const PORTAL_REPLACEMENT_REASON_CODES = [
  'damaged',
  'wrong_item',
  'lost_in_transit',
  'other',
] as const;
export type PortalReplacementReasonCode = (typeof PORTAL_REPLACEMENT_REASON_CODES)[number];

const CODE_SET = new Set<string>(PORTAL_REPLACEMENT_REASON_CODES);

/** The pinned contract version. The Client Portal renders only this version and fails closed on
 *  any other, so a label change upstream cannot silently reach a client. */
export const REPLACEMENT_REASON_CONTRACT_VERSION = 'replacement-request-v1';

export type ReplacementReasonContractEntry = {
  code: PortalReplacementReasonCode;
  label: string;
};

export type ReplacementReasonContract = {
  version: string;
  reasons: ReplacementReasonContractEntry[];
};

/**
 * The stored reason, exposed ONLY when it is a canonical code. A raw / legacy / free-text value
 * (the DB column is bare `reason text not null`) is redacted to null so it never crosses the
 * customer boundary — the client sees a label for a known code or nothing at all, never raw text.
 */
export function toReasonCode(
  raw: string | null | undefined,
): PortalReplacementReasonCode | null {
  return typeof raw === 'string' && CODE_SET.has(raw)
    ? (raw as PortalReplacementReasonCode)
    : null;
}

/**
 * Validate a PS-502 reason-contract response. Returns the contract ONLY when it is the pinned
 * version and carries every canonical code exactly once, each with a non-empty label. Any other
 * shape — wrong version, a missing / extra / duplicate / non-canonical code, an empty label, or
 * a malformed body — returns null so the caller FAILS CLOSED instead of rendering a stale or
 * invented label.
 */
export function validateReasonContract(payload: unknown): ReplacementReasonContract | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { version?: unknown; reasons?: unknown };
  if (candidate.version !== REPLACEMENT_REASON_CONTRACT_VERSION) return null;
  if (!Array.isArray(candidate.reasons)) return null;

  const entries: ReplacementReasonContractEntry[] = [];
  const seen = new Set<string>();
  for (const entry of candidate.reasons) {
    if (!entry || typeof entry !== 'object') return null;
    const { code, label } = entry as { code?: unknown; label?: unknown };
    if (typeof code !== 'string' || !CODE_SET.has(code)) return null;
    if (typeof label !== 'string' || label.trim().length === 0) return null;
    if (seen.has(code)) return null;
    seen.add(code);
    entries.push({ code: code as PortalReplacementReasonCode, label });
  }
  if (seen.size !== PORTAL_REPLACEMENT_REASON_CODES.length) return null;

  return { version: REPLACEMENT_REASON_CONTRACT_VERSION, reasons: entries };
}

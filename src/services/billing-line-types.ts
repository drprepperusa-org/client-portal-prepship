// The RETURN billing line-type vocabulary, in one place so every money surface agrees.
//
// CP-059 AC-6. These lists are transcribed from the PRODUCER's vocabulary, not from what this
// repo happens to write today. The first version of this file was built by grepping our own
// source for `line_type = '...'`, which surfaced only the two modern spellings — so the
// canonical return total it defined computed $0.00 for the exact legacy shape it existed to
// fix. The committed producer fixture emits five return line types, three of which our source
// never writes and all of which can already be sitting in billing_line_items.
//
// The grouping is the producer's, taken from the committed fixture:
//   - `return_label`      is POSTAGE      (shape 18: returnPostageTotal 5.25)
//   - `return_processing` is PROCESSING   (shape 19: returnProcessingTotal 2.75)
//   - `return`            is BARE return money that funds returnTotal while leaving both named
//                         parts at 0.00 and both presence flags false (shape 5: returnTotal 5.50)
//
// This is a static allowlist. It does NOT "fold in" a new upstream type on its own — an earlier
// comment here claimed that and it was untrue. What keeps it honest is
// scripts/cp-059-producer-contract-guard.ts, which reads every return line type out of the
// hash-enforced producer fixture and fails if this file does not cover it. Adding a return type
// upstream turns that guard red instead of silently zeroing a customer's return money.

/** Return postage, including the legacy `return_label` spelling. */
export const RETURN_POSTAGE_LINE_TYPES = ['return_postage', 'return_label'] as const;

/** Return processing, including the legacy `return_processing` spelling. */
export const RETURN_PROCESSING_LINE_TYPES = ['return_processing_fee', 'return_processing'] as const;

/**
 * Bare return money: attributable to a return, but to NEITHER named part.
 *
 * This is why returnTotal cannot be `postage + processing`. Such a row funds the total while
 * both parts stay 0.00, so the addition prints nothing for a real charge.
 */
export const RETURN_BARE_LINE_TYPES = ['return'] as const;

/**
 * ALL return money, as one canonical category.
 *
 * The two named parts are SUBSETS of this set, never its definition.
 */
export const RETURN_LINE_TYPES = [
  ...RETURN_POSTAGE_LINE_TYPES,
  ...RETURN_PROCESSING_LINE_TYPES,
  ...RETURN_BARE_LINE_TYPES,
] as const;

export type ReturnLineType = (typeof RETURN_LINE_TYPES)[number];

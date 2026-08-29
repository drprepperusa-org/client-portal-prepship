// The RETURN billing line-type vocabulary, in one place so every money surface agrees.
//
// CP-059 AC-6. These lists are transcribed from the PRODUCER's vocabulary, not from what this
// repo happens to write today. The first version of this file was built by grepping our own
// source for `line_type = '...'`, which surfaced only the two modern spellings — so the
// canonical return total it defined computed $0.00 for the exact legacy shape it existed to
// fix. The committed producer fixture emits five return line types, three of which our source
// never writes and all of which can already be sitting in billing_line_items.
//
// The grouping is the producer's, from prepship-v4 src/services/billing-row-status.ts:
//   - `return_label`      is POSTAGE      (isBillingReturnPostageLineType)
//   - `return_processing` is PROCESSING   (isBillingReturnProcessingLineType)
//   - `return`            is BARE return money that funds returnTotal while leaving both named
//                         parts at 0.00 and both presence flags false
//
// These are static allowlists. They do NOT "fold in" a new upstream type on their own. What
// keeps them honest is scripts/prepship-return-vocabulary-parity.mjs, which compares this file
// against the pinned upstream owner and fails when either drifts.
import { sql, type SQL } from 'drizzle-orm';

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

/**
 * Line-type membership as SQL — the ONE place normalisation is decided.
 *
 * Review found the reason this is a function rather than three exported lists. The aggregates
 * had been written as `lower(b.line_type) in (...)` while the customer-safety gate compared the
 * RAW text against the same lowercase list. `billing_line_items.line_type` is a bare
 * `text not null` with no lowercase constraint, so a row spelled `RETURN_LABEL` was classified
 * as return postage by the aggregate and simultaneously slipped past the postage validation —
 * unvalidated postage reaching customer-visible money through nothing but capitalisation.
 *
 * Upstream normalises before classifying (`normalizedText(lineType)?.toLowerCase()`). Every
 * caller here goes through these helpers, so the classification and the validation boundary
 * cannot normalise differently again: there is no list to compare against by hand.
 */
function lineTypeIn(lineType: SQL, types: readonly string[]): SQL {
  return sql`lower(coalesce(${lineType}, '')) in (${sql.join(
    types.map((type) => sql`${type}`),
    sql`, `,
  )})`;
}

/** True when the line is return POSTAGE, in any registered spelling and any case. */
export function isReturnPostageLineTypeSql(lineType: SQL): SQL {
  return lineTypeIn(lineType, RETURN_POSTAGE_LINE_TYPES);
}

/** True when the line is return PROCESSING, in any registered spelling and any case. */
export function isReturnProcessingLineTypeSql(lineType: SQL): SQL {
  return lineTypeIn(lineType, RETURN_PROCESSING_LINE_TYPES);
}

/** True when the line is return money of ANY kind — the canonical category. */
export function isReturnLineTypeSql(lineType: SQL): SQL {
  return lineTypeIn(lineType, RETURN_LINE_TYPES);
}

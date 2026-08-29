// The billing line-type vocabulary, in one place so every money surface agrees.
//
// CP-059 AC-6. Return money is ONE canonical category, defined by SET MEMBERSHIP rather than
// by adding its named parts wherever a total happens to be rendered.
//
// The producer emits a per-row `returnTotal` that can EXCEED the sum of its two named parts.
// A legacy bare return line funds `returnTotal` while setting neither presence flag — see the
// committed producer fixture, shape 5 ("LEGACY bare return line: funds returnTotal, sets
// NEITHER presence flag"): returnTotal 5.50, returnPostageTotal 0, returnProcessingTotal 0.
// Any surface that renders `returnPostage + returnProcessing` therefore prints $0.00 for a
// real $5.50 charge. The printable invoice footer did exactly that.
//
// Declaring the set here means a return line type introduced later folds into every return
// total automatically, instead of going silently missing from each footer until somebody
// remembers to extend an addition in three different files.
export const RETURN_LINE_TYPES = ['return_postage', 'return_processing_fee'] as const;

export type ReturnLineType = (typeof RETURN_LINE_TYPES)[number];

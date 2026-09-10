# PS-522 consumer compatibility

Base: `22883755a4f96f13bd5b2cf019c00fe26cfe8968`, isolated branch `feat/ps-522-portal-compat`.

The portal accepts `N/A` in the existing `destination` field issued by PrepShip's canonical billing destination/applicability owner. The strict whitelist still rejects unknown values. Portal code does not classify countries or decide whether an event is a shipping event. Existing event identities, effective dates, scope, field redaction, monetary DTOs and invoice calculations are unchanged.

Producer owner: `billing-destination-international.ts#classifyBillingDestination`, consumed by `billing-detail-row-sot.ts`. The producer defaults `BILLING_NON_SHIPPING_DESTINATION_NA` to false. Enabled output uses N/A only for proven non-shipping events, preserving Needs Review for unknown outbound destinations and existing return behavior.

## Release ordering

1. Release this compatible portal consumer while PrepShip still emits its old vocabulary.
2. Verify the portal consumer is active.
3. Enable `BILLING_NON_SHIPPING_DESTINATION_NA=true` in the compatible PrepShip producer release.

For rollback, turn off the producer flag before rolling back this consumer. No portal schema or data migration is needed. These changes are local; no push, deployment, production edits or provider calls occurred.

## Verification

All runs used Node 20.19.0 and offline inputs:

- Root typecheck and active `build:web`: pass.
- `guard:client-portal-architecture`, `test:client-portal-shadow-renderer`: pass.
- `test:cp-059-canonical-billing-render`: 19 checks pass, including N/A pass-through and unknown enum rejection.
- `test:cp-059-producer-contract`: 16 checks pass for the unchanged historical committed producer fixture. This fixture is not represented as new PS-522 output.
- `test:billing-client-scope`, `test:billing-line-item-sort-pagination`, `test:client-portal-billing-summary-canonical`: pass.
- CP-059 browser suite: six existing tests pass. Added PS-522 N/A browser test passes with unique canonical identity and no browser errors.
- `tsx scripts/ps-522-producer-compatibility-test.ts <absolute PrepShip checkout>` executes the actual working-tree producer, strict portal mapper, served DTO projection and printable HTML. It verifies N/A/Needs Review/Domestic, explicit zero, identities and unchanged money, and prints the actual producer file hashes. Pass.

The native PostgreSQL corrected-billing roundtrip is integrated separately through PrepShip's `scripts/ps-522-portal-fixture-proof.ts`; its execution result belongs to the PS-522 native command test report, not the pure fixture proof above.

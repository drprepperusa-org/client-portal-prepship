# Receiving preview

## Placement contract

- Outcome: before receiving an inbound shipment, show expected versus entered quantities, shortages/extras, SKU match issues and the units that would be added to inventory. Require a fresh valid preview before confirmation.
- Current gap: receivePortalInbound discovers missing SKUs while writing and can mark the shipment received without adding those units. Move resolution into a shared backend receiving plan used by both preview and commit. With inventory additions enabled, positive unmatched or ambiguous lines block the whole receipt. Explicit receive-without-inventory remains available.
- Sources: inbound_shipments owns scope, reference and status; inbound_items owns item identity, SKU/name and expectedQty. Received quantities are user intent until committed. Inventory matches use the existing same-client, case-insensitive SKU rule. No stock balance is inferred or cached.
- Backend DTO owns difference (entered minus expected), quantity status, match status, planned per-line additions and total units. Preview is a read-only database snapshot; commit rebuilds the plan under shipment/item locks and locks matched inventory identities. Its fingerprint pins reviewed intent and source identities; it is freshness evidence, not authorization.
- Canonical inventory writes remain applyInventoryMovementInTransaction with the existing shipment/item movement identities. Scope, terminal status and exact membership are checked again before writes. Stale plans fail before any write. No migration, provider call or real inventory mutation is needed for tests.
- React renders the plan and sends intent/fingerprint; editing quantities or the inventory option invalidates the preview. Existing draft, pending-save and failed-save protections remain.
- Verification: disposable PostgreSQL proof for read-only preview, tenant isolation, calculations, missing/duplicate/zero matches, stale source or intent, concurrency and atomic rollback. Browser proof for preview, invalidation, blocking feedback, failures, confirmed save, draft protection and mobile layout. Run release gates; direct main/live deployment is already authorized.

## Local verification

- Typecheck, production build, 875-file line-length guard and maintainability audit passed.
- Full repository suite: all 189 guards passed, including full-site certification.
- Eight receiving browser cases passed. The combined unsaved-form, validation, create, search, receive and import suite passed all 42 cases in one run. Mobile preview inspected at 390px; content remains within the modal.
- Disposable PostgreSQL receiving integration passed: scoped read-only preview, expected/entered differences and totals, case-insensitive matches, missing/duplicate/zero matches, required fingerprint, changed intent/expected quantity/match identity, concurrent confirmations, canonical receipts and forced second-line failure with complete rollback.
- Existing CSV import integration passed. Hosted workflows already include the updated receiving browser and integration suites.

## Rollout and rollback

Deploy frontend and API at the same commit. Older clients without a preview fingerprint receive a non-writing rejection and retain their draft; refresh after rollout to use Preview receipt. No migration or configuration changes. Rollback is a commit revert on both services; it does not undo any legitimately saved receipt or inventory ledger entry. No real production receiving or inventory mutation is used for release verification.

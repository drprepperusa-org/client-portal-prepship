# Field validation for Return and New Inbound

## Placement contract
- Outcome: explain invalid fields inline, focus the first problem on submission, and retain input after a failed save. Validate before sending, while the server revalidates before writing.
- Canonical syntax owner: shared, browser-safe create-form contracts under src/lib/client-portal/contracts. Existing returns actions retain ordered-quantity, scope, eligibility and duplicate checks; inbound route retains admin/client scope. No business money/status/label authority moves to React.
- Entry boundaries: untyped create request bodies; numeric coercion that otherwise drops malformed item rows or reaches an integer DB column; server errors discarded by transport. Preserve optional inbound header fields, blank row placeholders and zero expected quantities. Return reason/recipient limits and quantity rules follow current backend behavior/schema.
- API errors gain additive fieldErrors with form paths. Frontend associates them with inputs; selected return-line indices are mapped back to the displayed order lines. Unknown/global errors remain visible at form level.
- UX: controls remain actionable to show/focus errors; saving disables duplicate submission. No new automatic label action or Enter-to-buy behavior. Unsaved-draft protection stays in place.
- Checks: shared-contract boundary cases, real Hono routes with offline DB/provider boundaries proving rejection before writes and scope preservation, browser invalid-submit/focus/repair/server-error/phone tests, existing returns guards, full release guard suite, typecheck/build and hosted CI/integration.
- Deployment/main push authorized by this conversation. No real labels, postage, inventory writes, production records or marketplace notifications for testing. No migration.

## Verification
- All 189 local guards passed, including full-site certification, architecture, redaction, scope and existing return rules.
- Type checking, production frontend build, source line length and maintainability passed after the final focus correction.
- All 23 combined form validation and unsaved-draft browser cases passed. Coverage includes desktop/mobile, required fields, native unfinished numeric input, quantity bounds, server row mapping, retained drafts and 205-line orders with one selected return item.
- Offline tests exercise actual Hono create handlers: invalid requests produce field errors without writes; admin/client scope and omitted-recipient fallback remain intact. Hosted database integration is checked separately during release.
- A browser rerun during a concurrent build timed out before loading New Inbound; the full isolated rerun passed 23/23. The large-order test also caught and verified the correction to focus a specific invalid item within an invalid group.
- No database migration, environment-variable change or live business mutation is required. Revert this feature commit to restore the previous request/UI behavior.

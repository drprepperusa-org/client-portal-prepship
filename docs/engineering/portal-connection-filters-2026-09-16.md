# Connections filters

Connections now honors the global client selector and supports store-name search,
platform and backend status filters. Needs attention includes pending approval,
reconnect needed and sync delayed. Clear filters restores the current client's
connections. Empty and unavailable states remain distinct.

The existing read model scopes database reads first, converts rows through the
canonical redacted DTO, then filters the result. Client selection only narrows
access; store-only scope remains fail closed. Search uses safe display names,
never identifiers or credentials. Invalid client/status filters return 400.
The 200-store limit is removed: account metadata is returned for all scoped
connections, so older records cannot disappear before filtering. This also makes
the existing tenant freshness aggregation complete. Account metadata is expected
to be small; no order/shipment data is loaded by this change.

React requests use user/client/filter-specific cache keys and request cancellation.
Client changes remount the view to close old store editors. Filters use the existing
connection cards and commands. No mutations, provider validation/sync policy,
schema or dependencies changed. No real provider requests are made by tests.

Verification: PostgreSQL route fixtures include 208 stores, three attention statuses,
admin/client/store-only isolation, literal search, malformed filters and DTO redaction.
Three browser scenarios cover combined filters, clear/empty states, client switching
with an open editor, retry, late responses and mobile containment. Both suites run
in hosted CI. CP-054 guards, typecheck and maintainability checks pass.

Release base / rollback: `7583708843547b3049421ba349d34e0ae2f4d55f`.
Direct main deployment follows the user's standing authorization.

Final local release gate: all 186 static guards passed, including full-site certification, production build and existing browser proofs. API and frontend dependency manifests match their lockfiles. Desktop/mobile screenshots were inspected.

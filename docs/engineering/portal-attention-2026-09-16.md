# Client portal Needs attention

## Outcome and placement

The notification bell shows current scoped connection issues and low/out stock
counts, with links to the corresponding filtered pages. Empty, loading and
unavailable states are distinct. Refresh and opening the bell recheck the server.

The backend composition owner is `read-models/attention.ts`. Inventory delegates
to the same selector as `listPortalInventory`, including active/client attribution,
scope, ledger quantity and reorder filter; only the complete count is selected.
Connections delegate to `listPortalStoreIntegrations` and `filterPortalIntegrations`
with `status=attention`. No carrier credentials or diagnostic details are returned.
The earliest possible errors are scope selection and failed owner reads: both must
remain fail closed. A failed read returns 503, never an empty success.

`PortalAttention` owns the two counts, their sum, and the response completion clock
`checkedAt`. No event history, unread state, or historical date filter is implied.
The browser formats this DTO and navigates; it does not classify stock or health.
Query keys include user and selected client; AbortSignal cancels obsolete reads.
Polling follows the existing ten-minute portal cadence, with manual refresh.

The existing sync footer remains a view of all assigned stores. Attention counts
are selected-client scoped. Inventory store-only access and Connections store-only
fail-closed behavior are preserved from their respective canonical owners.

## Verification and release

Disposable PostgreSQL exercises >100 stock rows, parity with the filtered lists,
admin/client/store scopes, missing scope, invalid client IDs, safe DTO fields,
committed movement refresh and simulated backend failure. Playwright exercises
counts, destination filters, desktop/mobile containment, keyboard dismissal,
failure/retry, zero state and a late previous-client response.

No schema, auth policy, environment variable or worker change. No provider calls,
business writes, email or external notifications are part of this feature.
Deployment follows the user's standing direct-main/live authorization.
Rollback is a revert of this commit; existing APIs remain compatible.

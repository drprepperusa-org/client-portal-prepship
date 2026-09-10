# Shared table updating feedback

Base: portal main `324ac4423ebade0a8d48a955eb028b077e10b583`.

## Placement and behavior

Backend read models remain the canonical owners of rows, sorting, scope, money, quantities, totals and pagination. This change controls presentation during pending reads; no backend, database, provider, freshness or polling rules change.

The missing feedback originated at the shared QueryState/DataTable boundary: pages supplied initial-loading flags only, while only Billing line items opted into scoped placeholder data. TableUpdateStatus now provides one accessible spinner/text implementation, used by QueryState, DataTable and the few pages that own their panel wrappers.

- Covered: Orders, Inventory, Inventory History, Shipments, Returns, Inbound Receipts, Expected Inbound, Billing periods/details, Dashboard Top SKUs, Analysis SKU/combinations and Audit Log.
- Initial load still shows skeletons. Active refreshes show Updating; local sorts and fresh cache hits do not fabricate a request/spinner.
- Enabled list/report hooks retain display data within an authenticated user and client scope during sorting/filter/page changes. Audit store changes and order-specific return changes are also boundaries. Billing detail continues to treat its exact invoice period as a boundary.
- Client/account/logout changes clear previous display rows. Financial values stay backend-issued; retained rows are not written back. Orders explicitly exclude placeholder counts from the sidebar cache.
- Inbound Receipts now uses the same user-scoped cancellable query hook. Inventory History also separates cache entries by selected client, without changing its backend request contract.
- Failures remain explicit/retriable. Empty results clear old rows; pending empty filters show updating feedback before declaring a settled empty result.
- The reconnecting banner uses React Query's batched subscription hook, retaining its existing retry predicate and removing a synchronous render-time state-update warning observed during filter tests.

## Verification

- Typecheck and active frontend build passed.
- Contract drift, architecture, shadow renderer, session-scope, auth-cache, Billing sorting and failure-state guards passed.
- Actual hook boundary test passed for nine surfaces: user/client/logout fences, signal forwarding and placeholder count isolation.
- 27 offline Chromium tests passed: existing Billing and table sort contracts, six delayed table sorts with retained DOM rows, cached-sort cancellation/late-response handling, Inventory search/empty/client switching, failure/Retry, and mobile updating feedback.
- The client-switch browser check asserts no console errors.

Scope: implementation and local verification only. No push, deployment, schema change, production data mutation, purchase or provider request.

# Analysis search, pagination and full-period summaries

## Placement contract

Outcome: reach every matching SKU and SKU order, with server search/sort and bounded pages; changing table search/page must not change the full-period summary or top-five chart. Detail orders use the selected client and inclusive UTC date window. Client/date changes reset page and close stale details.

Canonical owners remain getSkuBreakdownFromOrderItems over orders/order_items and getSkuOrdersForSku for allocated canonical shipping. The truncation entered at the SKU SQL LIMIT and the drawer SQL LIMIT plus browser slice. analysisPageSql wraps the same scoped aggregate; it owns table search, stable ordering, matching count, clamped page and the separate unfiltered top-five projection in one statement. No new source data, financial calculation or status owner.

The API whitelist applies to both page and top-five rows. Scope predicates run inside the original owners before aggregation; caller client/store filters only narrow them. Financial permission redaction stays at the existing boundary and financial sort requests are neutralized for callers without permission. Full-period units/revenue and combinations continue to use their canonical owners, without table-search input.

Success proof: more than 200 SKU rows and orders, tied ordering, literal search, empty/last pages, full-period totals/top-five invariance, client/store scope, DTO redaction, inclusive dates, browser search/reset/sort/retry and drawer pagination. No migrations, new dependencies, production business writes or provider side effects.

Release base/rollback: f6e10e08c3b5d25c3126e38b670bd3dc85ee4862. Direct main push and live verification under the user's standing authorization. Await complete hosted CI.

## Verification evidence

- New native PostgreSQL route fixtures pass with 211 SKUs and 210 orders for one SKU. They cover every page, tied ordering, literal/case-insensitive search, malicious search/sort input, empty results, page clamping, full-period KPI/top-five/combination invariance, client/store narrowing, fail-closed scope, and financial DTO redaction.
- Existing CP-060 shipping classification integration, complete portal integration, and CP-048 access-security integration pass against the disposable local database.
- Three browser scenarios pass: table search/sort/page reset with invariant summaries, selected-client/inclusive-date drawer paging through order 210 on desktop/mobile, and retry/stale-response handling. Desktop/mobile screenshots inspected.
- The new PostgreSQL and browser proofs are registered in hosted CI. DTO whitelist checks explicitly cover pagination metadata; no shared/internal fields are spread into the customer response.
- Backend/frontend typechecks, manifest/lock dependency consistency, and maintainability checks pass. New SQL paging preserves the existing canonical owners and read budget.
- Boundary fixtures exposed and now pin the admin client-filter narrowing fix. The selected-period drawer uses UTC day bucketing so late-night records do not disappear when the database session timezone differs.
- Full release runner completed all 186 checks: 185 passed, including production build/bundle budget, full-site certification and existing portal browser proofs. Its sole failure was two overlong lines; formatting was repaired and the source-line-length guard and affected analytics-parity guard both pass on the final source. No behavior changed in that repair.

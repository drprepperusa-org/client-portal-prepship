# Inbound search and pagination

## Placement contract

- The inbound read-model owns search, status filtering, stable pagination and counts over canonical `inbound_shipments` and `inbound_items`.
- Preserve the existing explicit client assignment boundary: global users may read all; restricted users need an assigned client. Store-only access does not grant access to these client-level purchase orders.
- Search matches literal, case-insensitive substrings in reference, supplier, tracking number or item SKU. Item matches use EXISTS so shipments and counts are not duplicated.
- The existing DTO owns quantities and dates. Matching a SKU returns all items of its shipment, preserving canonical totals.
- The route validates input and delegates. The React page owns presentation, debouncing and separate expected-shipment paging; received-inventory controls remain independent.
- No schema change, provider call or production data mutation is needed.

## Verification

Use disposable PostgreSQL for scope, search beyond the old 200-row cap, status, literal wildcard and pagination tests. Browser fixtures cover request parameters, filter/page resets, empty results, details and narrow screens. Run repository checks and verify the exact main commit on both deployments.

## Local results

- Disposable PostgreSQL integration passed: 207 seeded headers, search beyond the old cap, duplicate SKU matches, full item totals, all statuses, literal wildcard handling, client/store boundaries, page clamping and invalid queries.
- Three new browser flows passed: search/status/page resets and detail opening; empty/retry/mobile; late response isolation. Existing 26 create, field-validation and unsaved-form browser cases also passed.
- Typecheck, production build, source-line limit and maintainability passed. Full repository suite: 189/189 checks passed.
- No migration or live business-data mutation. Deployment evidence is recorded outside the repository after release.

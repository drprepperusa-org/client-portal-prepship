# PS-486: consistent order status and return eligibility

Order #1298 exposed two problems: the Orders table consumed `fulfillmentStatus`,
but its detail drawer rendered the historical `orderStatus=shipped`; the drawer
also offered return creation without a backend eligibility decision.

## Placement and behavior

- **Status owner:** `src/lib/client-portal/order-status.ts` remains authoritative.
  The shared `OrderStatusBadge` now renders its DTO result in the table and all
  uses of the shared order-detail panel. A shipped order with only voided
  outbound shipments displays **Voided**. This does not cancel the order.
- **Imperfect-data entry:** legacy order flags can remain shipped after a label
  is voided or an upstream order is cancelled. A cached page can also retain
  eligibility after shipment facts change. Neither raw flags nor browser input
  may override the current backend decision.
- **Shipment projection:** `order-fulfillment-signals.ts` supplies the same
  active/voided/tracking facts to list, detail, and return creation. It preserves
  exact order matching and same-client orphan matching, and excludes inbound
  return labels from evidence of original outbound fulfillment.
- **Return-request policy:** `src/services/return-eligibility.ts` delegates status
  classification to the existing owner. Cancelled, voided-only, and pending
  orders cannot start a return. In-transit and delivered orders can request
  one. Existing shipped-without-local-label external-order behavior is retained;
  this is not a new physical-delivery certification requirement.
- **Persistence owner:** `src/services/return-request.ts` rechecks scope, locks
  the order, then re-reads current fulfillment facts. It rejects ineligible
  requests with HTTP 409 and writes return header/items atomically when allowed.
  The existing unique active-return constraint remains authoritative, and its
  wrapped PostgreSQL error maps to a 409 rather than a generic 500.
- **UI role:** `StartReturnButton` and `ReturnCreateModal` consume the backend
  `returnEligibility` result and reason. Missing policy is disabled. Both Orders
  and Shipments entry points use the same component. There is no frontend status
  rule for return eligibility and no raw-status fallback in the detail badge.

The policy is about creating a return request. Label/postage, delivery, billing,
refund, inventory, and existing-return operations retain their own owners and
checks. No historical order, shipment, billing, or inventory repair is included.
In particular, #1298's upstream cancellation and July opening-stock provenance
remain separate from this display correction.

## Proof

- `npm run typecheck`: API and active portal.
- `npm run build:web`: production portal build.
- `npm run test:client-portal-order-status`: backend precedence, shared SQL
  projection, tenant scope, return-label exclusion, and drawer/table wiring.
- `npm run test:client-portal-order-detail`: existing detail/DTO contracts.
- `npm run test:ps486-return-eligibility:integration`: 28 checks against a local
  PostgreSQL 17 fixture using real Hono create routes and list/detail read models.
  Covers voided-only, active replacement, inbound-return contamination, cancelled,
  pending, delivered, existing external orders, stale/forged client eligibility,
  duplicate creation, and same-client versus foreign orphan evidence.
- `npm run test:ps486-status:browser`: four Chromium cases render the actual
  table and drawer, verify matching badges and enabled/disabled return actions,
  and assert no mutation requests. Screenshots are saved in ignored test results.
- The integration and browser proofs are wired into their existing CI workflows.
- Full guard sweep: 178/180 passed in the initial run. The invoice-export
  no-local-builder guard completed all eight assertions but was interrupted
  during its cleanup timer; its standalone rerun exited successfully. The
  CP-045 reference guard passed after preserving the existing explicit property
  spelling. All 180 guards are therefore covered across the sweep and reruns;
  this is not a claim that the initial sweep was green.

All fixture integration network calls are blocked. No real labels, postage,
marketplace messages, or production application-data mutations were performed.
The local PostgreSQL test runner uses a dedicated local database; never point
`TEST_DATABASE_URL` at production.

## Release

Deploy the portal API on Render and the frontend on Vercel from the same main
commit. This change requires no migration. A frontend deployed before its API
temporarily disables return entry points until the eligibility field arrives;
it does not infer permission from old data.

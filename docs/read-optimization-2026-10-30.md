# Client Portal read optimization — 2026-10-30



## Placement



The portal remains a shadow renderer. PrepShip's invoice totals owner and history-wide duplicate policy remain authoritative. `keyBillingSummaryRows` owns period/client mapping; `assignCanonicalTotals` binds each returned total to its original row. The new batch proxy translates transport shapes only. It does not calculate charges, infer missing fees, cache money, or silently fall back after an upstream failure.



`src/lib/client-portal/read-models/orders.ts` remains the Orders read owner. Two identical latest-active-shipment subqueries previously selected tracking and carrier separately. One JSON projection now obtains both from the same row. It still uses `orderOutboundShipmentMatchSql`, excludes voided/return shipments and blank tracking, and selects the newest ID. List/detail DTOs and redaction are unchanged. Other shipment status/money predicates remain with their existing owners.



## Boundaries and failure handling



- Billing's imperfect-input boundary is the upstream response. Batch results must contain every requested period/client exactly once, with valid financial fields, including numeric Customs/Duties. A missing or malformed value rejects the entire response; absence never becomes a zero charge.

- Batch requests carry the existing authorization and request ID. They are split at 8 periods / 200 client IDs / 7500 URL characters and sent sequentially, retaining PrepShip's two-period concurrency bound.

- Client/store scope is enforced by existing portal and PrepShip boundaries. No frontend filtering is used as authorization.

- Orders' imperfect-input boundary is shipment history (voided, return, blank tracking, duplicate order-number references). The shared existing shipment-match owner remains authoritative.



## Rollout



`PREPSHIP_INVOICE_TOTALS_BATCH_ENABLED` defaults to `false`. Deploy and verify PrepShip's additive `/billing/invoice-totals/batch` endpoint first, then enable the portal flag. Disabled mode preserves the deployed individual-period transport; enabled mode fails closed without a silent retry/fallback. No schema migration or application-data write is required.



The companion PrepShip read optimization hydrates only selected complete billing events for reference/date sorts, including the portal's default reference-descending view. Enriched sorts and full-period admin footer/review views still use the complete canonical calculation.



## Validation



- API and portal typechecks pass; active `portal-client` production build passes.

- `test:client-portal-billing-batch`: actual route/proxy execution with substituted I/O; enabled/disabled parity, exact period/client assignment, scope, limits, strict Customs/Duties presence, failure and redaction checks pass.

- `test:client-portal-shipment-projection`: old/new SQL parity over 1,005 orders and 3,007 shipment fixtures. EXPLAIN ANALYZE reports 2,010 old lookup executions versus 1,005 new executions. This is a disposable in-memory measurement, not a production latency promise.

- Canonical Orders data, Customs/Duties, billing sort/pagination and billing summary canonical-assignment guards pass.

- The automatic static guard runner discovers both new tests through package scripts.



No production data, charges, shipments, labels, inventory, or marketplace state was modified. Work is isolated from the user's existing local billing edits.


## Full-suite audit

The full 193-command guard runner completed. Two checks that counted the old duplicated shipment subqueries were updated to require one shared projection in both list and detail, and both passed on rerun. The remaining failures reproduce on unchanged main `69dfb69`:

- CI DB suite wiring: the monthly-periods integration script lacks a named workflow step.
- UI baseline: keyboard column movement, two CP-062 return-arrival checks, and the CP-058 label-pending state fail; the focused unchanged-baseline run had 4 failures and 5 passes. These frontend files are unchanged by the optimization.
- Full-site certification stops at maintainability: the existing Returns component is 355 lines against a 350-line limit.

These baseline failures are recorded, not waived. The existing mutation harness restored every temporary source mutation; the final diff contains only the intended optimization and its checks/docs.

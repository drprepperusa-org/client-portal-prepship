# Shared-database optimization — local implementation and evidence

> Current follow-up: [Billing visibility repair and repeated measurements](shared-database-rendering-followup-2026-09-09.md), following the [allocation repair and final checks](shared-database-final-followup-2026-09-08.md). This earlier report preserves its original measurements and historical limitations.

Status: all six implementation phases are present in isolated local changesets. Functional verification has passed the focused checks below. **The full performance acceptance grid is not yet certified; this is not deployment approval.** No push, deployment, merge, production write, provider probe, purchase, printing, or production schema change was performed.
> Follow-up: [extended validation and remaining gates](shared-database-validation-2026-09-08.md). Separate-process query/wait traces and paired native-widget browser measurements are now available; release certification remains open.

## Baselines and method

- PrepShip: deployed lineage `dc3b243566d0296d7bb87056b8b27fb9e6d9a7a6`.
- Portal: verified GitHub main and Render live commit `164f5520b04c78241ae6edf529d58741c9258b76`. Its PS-486 status and return-eligibility changes are retained.
- Both changesets use `perf/shared-db-optimization`, in separate repositories, outside PS-509.
- Windows, Node 20.19.0, native PostgreSQL 17.11. Both applications' database clients connected to the same disposable local `ps520_invoice_routes` database. Providers were offline.
- Native invoice tests apply the existing migration chain and provision portal-owned fixture tables locally. No migration or index was added to either application.
- Fixed date/client scopes, small and large datasets, 50 warm iterations per version with one and four concurrent callers. Four callers produce 200 request observations per scenario. JSON evidence retains every scenario.
- Baseline owners are loaded from the exact commits above. Unchanged dependencies are shared. Orders baseline uses the old route orchestration and old call shapes; current optional fact-reuse arguments are not supplied by the baseline route.
- Final measurement run ID: `2026-09-08T08:04:12.768Z`.
- These are native owner/Hono request measurements, including JSON parsing where noted, **not browser navigation or production latency**. `coldMs` is the first measured request after fixture/parity setup; it is not a true cold application, connection, or OS-cache measurement.
- Database operation duration includes connection wait; the two have not been separated. Query counts are instrumented for margin and Analysis owners, not every nested query across every workflow.
- Measurements below were collected in one uninterrupted run without simultaneous builds or guard packs. Earlier runs with empty Orders pages or changing query statistics were discarded. Fixtures now assert nonempty pages, real product defaults, and use `ANALYZE` before measurement.

## Phase 1 — portal database transport

Pinned `postgres` to 3.4.9 in the manifest and lockfile, installed the same reservation compatibility patch used by PrepShip, and disabled overlapping implicit transactions in the main portal database client. Pool sizes, statement timeout and idle-transaction timeout are unchanged.

Before: the old portal wire fixture queued 12 implicit transactions on one socket, completed 0/12, and timed out. A separate negative control proves that `max_pipeline=1` still overlaps two transactions and stalls. After: `max_pipeline=0` with the reservation patch completes all 12 concurrent reads, follow-up work, BEGIN, rollback and connection reuse, including accepted-write backpressure. Native ESM and CJS tests each passed at pool sizes 1 and 4, with eight concurrent transactions per configuration, savepoint and outer rollback, and temporary-table isolation.

A clean `npm ci --no-audit --no-fund` ran the install patch successfully for ESM, CJS and Cloudflare distributions. This is functional transport evidence, not a 50-run cold/warm latency benchmark.

Read-only deployment inspection found transaction-pooler URLs on port 6543. The live portal source/lockfile resolves 3.4.9, but its Render build command is `yarn` and that source has no yarn.lock. Available build logs do not positively establish the installed runtime version. Treat exact deployed driver identity as unverified until inspectable installation evidence is available; no production configuration was changed to obtain it.

Connection budget inventory, one instance of each inspected service:

| Component | Main pool maximum | Other pools / role |
|---|---:|---|
| PrepShip API | 12 | Health pool max 3; queue producers/status probes may create additional max-1 pools |
| PrepShip sync worker | 4 | pg-boss consumer max 1; maintenance/recovery/status helpers include max-1 pools |
| PrepShip print worker | 4 | Print consumer max 1; dedicated queue URL uses direct port 5432 |
| Portal API | 10 | Health pool max 3; portal-only mode prevents the sync scheduler from starting |

Main pools sum to 30; the two API health pools add capacity for 6 more sockets. **36 is not the total database connection ceiling**: queue producers, consumers, transient maintenance pools, health-pool replacement overlap, and multiple processes must also be counted. Capacity is configured potential usage, not continuously occupied sockets. `PG_BOSS_POOL_MAX` was inspected as 1 for API/sync and unset with code default 1 for print/portal. No limits were increased.

## Phase 2 — portal reads and cancellation

Foreground and speculative Dashboard, Orders and Inventory reads now use the same user/client/filter/page query-key factory. Inventory includes page size. Removed unused daily-count prefetching. Speculation waits for foreground work, runs one request at a time, and pauses while hidden. Cache freshness and background polling intervals are unchanged.

React Query signals now reach the GET/text/blob transport. Deadlines remain active through body parsing. Obsolete reads abort, while another active observer can retain a shared request. Existing logout/account-switch cache clearing remains authoritative alongside backend scope checks.

Browser proof: hidden tabs start zero speculative Dashboard/Inventory reads; visible speculation has peak concurrency 1; Inventory navigation reuses its completed prefetch with one total Inventory request; no daily-count prefetch occurs. One observer leaving does not abort a shared request; the last observer leaving does, with no retry. Different user/page-size keys do not reuse the result. A deliberately stalled HTTP response body aborts at the deadline and disconnects its socket. Baseline prefetch behavior is established from source and the initial audit, not a matched 50-run browser baseline.

## Phase 3 — canonical billing pagination

PrepShip accepts optional page/pageSize/sortBy/sortDir, with default size 100 and maximum 500. Complete canonical billing events are formed before sorting/slicing. Whole-range invoice totals come from the existing owner. Unpaged requests and full exports remain supported; multi-client null totals remain intact. The portal validates returned pagination, enriches only returned rows and never falls back to a full download on a malformed page.

Prerequisite found during integration: deployed PrepShip did not emit the `canonicalEventId` required by the existing portal contract. Added only the established CP-059 identity algorithm (32 hex characters from SHA-256 of the existing grouping key). Native tests compare every pre-existing field against the deployed owner, with only this additive identity removed for comparison. No alternate grouping or money policy was imported. Both pagination benchmark variants include this prerequisite so they isolate pagination rather than compare a working page with a contract failure.

Native parity covers all 11 supported sorts in both directions, ties/nulls, concatenated complete pages, IDs, invalid and out-of-range pages, whole-range totals, outbound/return/replacement/storage/adjustment cases, duplicates, cancelled orders and date boundaries. The actual producer route and portal consumer agree, including item text and totals.

| Dataset / callers | Before median / p95 | After median / p95 | Producer bytes before → after |
|---|---|---|---|
| 30 events / 1 | 20.40 / 31.28 ms | 21.26 / 25.88 ms | 75,998 → 76,063 |
| 3,000 events / 1 | 488.78 / 536.56 ms | 428.47 / 477.04 ms | 7,584,148 → 253,217 |
| 3,000 events / 4 | 1,748.68 / 1,852.33 ms | 1,555.38 / 1,614.92 ms | 7,584,148 → 253,217 |

Large-range transfer fell about 96.7%. Small responses gain pagination metadata and need not become faster. PrepShip still assembles the complete range: **database work is not proportional to page size**. Pagination is not a frozen snapshot across concurrent data changes; a refreshed request reflects current canonical data.

## Phase 4 — PrepShip Billing reads

Added compatible summary/details modes. Billing loads aggregates first; the reconciliation section requests 100-row pages only when opened. Shipment candidates restrict billing-line aggregation and relevant account IDs restrict historical nickname scanning, while nickname evidence remains all-time. Existing exclusions, billing-derived attribution, money resolution and aggregation are unchanged. Same-range in-process summary rebuilds share pending work, remove settled/failed entries and reapply scope when reading results.

Browser proof: collapsed reconciliation requests zero detail rows; opening requests page 1, size 100. Native full-response/aggregate/page parity and historical nickname evidence pass. Twenty-five simultaneous same-range refresh callers execute one refresh; different ranges and retry after failure remain independent.

| Dataset / callers | Before median / p95 | After median / p95 | Response bytes before → after |
|---|---|---|---|
| 30 shipments / 1 | 2.15 / 3.69 ms | 2.62 / 3.54 ms | 20,388 → 1,355 |
| 300 shipments + 10,000 historical / 1 | 9.62 / 10.91 ms | 7.97 / 10.09 ms | 192,212 → 1,364 |
| 300 shipments + 10,000 historical / 4 | 14.06 / 18.89 ms | 12.19 / 15.63 ms | 192,212 → 1,364 |

Small-range database work is slightly slower; the structural benefit is lower transfer and deferred details. Summary mode still computes complete canonical aggregates in memory. Background refresh, increased concurrency and cross-process singleflight remain deferred.

## Phase 5 — PrepShip Orders

Page enrichment uses a two-operation request budget. Detail/full paths reuse authorized order/override/default facts and schedule independent package-default, tracking and hazmat reads without changing DTOs or action eligibility. A null best-effort default retains the old recovery read. An eight-SKU fixture proves nested lookups stay within the outer two-read budget; a failed lookup returns the existing null fallback with no queued SKU reads left behind. Exact counts, provider behavior and configured pool capacity are unchanged.

Native comparisons passed for populated list/detail/full responses, including SKU and combo defaults. The 200-row payload remains 3,496,810 bytes because no DTO fields were removed.

| Dataset / path / callers | Before median / p95 | After median / p95 |
|---|---|---|
| 3-row list / 1 | 9.39 / 12.47 ms | 7.13 / 9.49 ms |
| 200-row list / 1 | 71.47 / 86.37 ms | 68.77 / 77.63 ms |
| 200-row list / 4 | 218.05 / 324.56 ms | 212.01 / 309.17 ms |
| Large fixture detail / 1 | 11.32 / 14.04 ms | 6.69 / 8.91 ms |
| Large fixture full / 1 | 9.85 / 13.91 ms | 5.75 / 7.28 ms |

Detail gains are larger than list gains. Small-list four-caller p95 changed from 23.87 to 19.03 ms; all scenarios are retained in the evidence rather than selecting only wins.

## Phase 6 — portal analytics

Replaced four request-time ALTER statements with a read-only boot/request capability check, shared while pending. Missing columns yield a controlled analytics 503 with retry backoff; unrelated pages remain available. Dashboard/Analysis share a two-operation budget per workflow. Dashboard skips its unused separate order-count calculation. Canonical sales/shipping owners, redaction, scopes and audit persistence remain unchanged.

Native Analysis DTO, empty restricted scope and financial redaction comparisons pass. Query count for the measured Analysis owner remains 3 per read; concurrency changes from 1 to at most 2 within a request. Startup capability queries are outside this warm owner timing. The measured companion is an unchanged PrepShip Shipping Margin workload on the same database.

| Dataset / portal callers | Before median / p95 | After median / p95 | Companion p95 before → after |
|---|---|---|---|
| 30 orders / 1 | 12.94 / 17.25 ms | 9.34 / 10.88 ms | 14.89 → 11.29 ms |
| 30 orders / 4 | 14.55 / 17.05 ms | 11.53 / 15.25 ms | 14.37 → 15.26 ms |
| 3,000 orders / 1 | 37.26 / 39.61 ms | 30.82 / 32.56 ms | 10.30 → 11.06 ms |
| 3,000 orders / 4 | 38.65 / 47.96 ms | 33.54 / 44.13 ms | 14.21 → 14.19 ms |

Full Dashboard owner timings (the baseline includes its separate order-count query; the candidate skips that unused output):

| Dataset / portal callers | Before median / p95 | After median / p95 | Companion p95 before → after |
|---|---|---|---|
| 30 orders / 1 | 12.57 / 14.98 ms | 9.84 / 12.98 ms | 11.39 → 12.42 ms |
| 30 orders / 4 | 17.17 / 21.79 ms | 14.34 / 18.08 ms | 18.33 → 15.59 ms |
| 3,000 orders / 1 | 39.42 / 46.31 ms | 36.03 / 38.57 ms | 14.17 → 11.85 ms |
| 3,000 orders / 4 | 41.17 / 54.17 ms | 39.87 / 50.76 ms | 15.47 → 14.36 ms |


## Companion measurements

| Phase / largest observed companion change | Baseline p95 | Candidate p95 | Change |
|---|---|---|---|
| 3: Billing pagination, small, 1 callers | 10.01 ms | 12.03 ms | 20.14% — needs recheck |
| 4: margin, large, 1 callers | 39.04 ms | 41.49 ms | 6.29% |
| 5: full, small, 4 callers | 14.33 ms | 15.89 ms | 10.89% — needs recheck |
| 6: Dashboard, small, 1 callers | 11.39 ms | 12.42 ms | 9.00% |

Two scenarios exceeded 10% in the initial run. Both were repeated in three rounds of 50 paired iterations, alternating baseline/candidate order. Pooled companion p95 was 10.95 → 11.31 ms (+3.23%) for Billing and 16.81 → 16.37 ms (−2.63%) for Orders full. The first paired Billing round was still +10.66%; its other rounds were below 10%. This did not demonstrate a sustained >10% regression, but it is not a deployment waiver. The initial results and every paired sample remain in `native-companion-recheck.json`.

These owner-level scenarios run in one Node process with separate application database clients; they are not a substitute for separate-server/browser deployment measurements. Full scenarios are in the JSON evidence.

## Verification, outstanding gates and release order

Focused passes include both typechecks and active frontend builds; install/driver wire/native tests; canonical billing pagination and invoice route tests; Orders/package/default/insurance/hazmat and rate-source-of-truth guards; portal architecture, shadow-renderer, contract drift, session/scope, billing, analytics and runtime-DDL guards; cancellation/prefetch and Billing lazy-detail browser tests; 28 native PS-486 return-eligibility checks with zero external calls. The existing whole shipping-margin browser file has a separate stale Dashboard reporting-window fixture; the focused Billing scenario passes.

The full PrepShip SOT pack initially passed every command except the mutation manifest, which correctly refused dirty target files. A clean local verification snapshot was created at `cd1975494a966aac75caa6303f991f009166b2c1`; the full pack and typecheck passed there, with outcomes recorded separately in `verification-status.json`. No guard was weakened to bypass that prerequisite. Source-shape guards were updated where delegation signatures changed, while their business assertions and negative controls remain in place.

Remaining acceptance work before release certification:

1. True cold-load and 50-run browser first-useful/complete-result measurements for both applications against the shared native fixture, rather than treating owner timings as browser timings.
2. Separate connection-wait measurements and complete nested database query counts for all workflows.
3. Separate-server/browser companion scenarios, especially phases 1–2. The paired owner-level rechecks above are retained as provisional evidence; no >10% result is waived. Native owner matrices now include phases 3–6 and full Dashboard values/redaction.
4. Exact installed live portal driver evidence; source/lock/config inspection alone leaves the yarn installation ambiguity described above.
5. Remaining transition/failure scenario matrix beyond inherited guards and focused checks. The native producer/consumer test now covers a changed charge between refreshes and restores its fixture before timing.

No index, hosting, freshness or capacity proposal is included. These need separate evidence and authorization. The implementation is available for review, with performance certification explicitly open.

When separately authorized and certified, ship independent phases in order. Release PrepShip's backward-compatible billing producer before its portal consumer. Roll back the consumer before removing producer support. Driver rollback requires a clean dependency installation. Existing pricing, invoice, inventory, authorization, shipping and production release gates remain mandatory.

## Reproduction and evidence

Run `node scripts/run-shared-db-checks.mjs <npm-script> ...` in the respective repository. The runner strips inherited application credentials and sets offline defaults. `SHARED_DB_NODE` and `SHARED_DB_NPM_CLI` can select a runtime explicitly. Native tests require `SHARED_DB_TEST_ADMIN_URL` for a disposable loopback PostgreSQL; never use the production URL. Both worktrees must exist as siblings, or set the portal-root override in the native harness.

`SHARED_DB_PARITY_ONLY=1` runs native functional checks without replacing measurement files. Adding `SHARED_DB_RECHECK=1` performs the paired companion rechecks and writes a separate artifact. Normal runs use 50 warm iterations; all six primary measurement files share one run ID.

- PrepShip native integrated comparison: `test:shared-db-native`.
- Portal transport: `test:database-pipeline`, `test:database-pipeline:pg17`.
- Both: `test:shared-db-boundaries`.
- Portal browser: `test:shared-db-reads:browser`; native return check: `test:shared-db-native:returns`.
- PrepShip browser: `test:shared-db-margin:browser`; complete source-of-truth pack: `test:sot-guard-pack` from a clean snapshot.

The adjacent `shared-db-evidence` directory contains full scenario JSON, verification summaries and a normalized-source hash manifest. Local raw logs remain under PrepShip `tmp/shared-db` and portal `reports/shared-db`. Numeric results are fixture measurements, not a promise of carrier or production speed.

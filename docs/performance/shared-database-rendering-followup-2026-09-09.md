> Final review update (2026-09-09): local verification blockers were found and repaired. See [the repair report](shared-database-review-repairs-2026-09-09.md) and its release boundaries. The focused measurements below remain historical evidence.

# Shared-database optimization: Billing visibility follow-up

This follow-up investigates the small four-user Billing first-visible tradeoff retained in [the preceding report](shared-database-final-followup-2026-09-08.md). It is local development evidence, not production certification.

## Placement and change

The outcome is to show returned billing rows promptly. The existing Portal invoice-summary route still delegates money to PrepShip's canonical invoice-total owner; invoice-details still delegates canonical events, identities, ordering, pagination and whole-range totals to PrepShip's billing owner. Their reporting clocks, client/store scope, financial redaction, audit persistence and DTO fields are unchanged.

The observed delay enters after data delivery, in presentation: the Layout route container starts with opacity zero and blur, and both desktop and mobile DataTable rows start at opacity zero with staggered animation. A diagnostic smoke run recorded every observed warm billing row initially transparent, despite already being present in the DOM. Its extra instrumentation and eight warm loads per version make it diagnostic evidence only, not a latency acceptance sample.

The repair replaces those three motion wrappers with ordinary elements, preserving their keys, classes, children, column layout, sorting, row callbacks and accessible actions. QueryState still controls loading/error/empty states. No business computation, backend owner, API transport, prefetch schedule, cache freshness or connection capacity changes in this follow-up.

Runtime files, in the active Portal frontend:

- `portal-client/src/components/layout/Layout.tsx`
- `portal-client/src/components/ui/data-table/DataTableDesktop.tsx`
- `portal-client/src/components/ui/data-table/DataTableMobile.tsx`

The existing frontend-auth-cache guard needed an expectation update for phase 2's already implemented `{ accessToken, signal }` argument and user-scoped query key. It continues to require the AuthProvider's single session bootstrap and cached-token query gating, now also checking cancellation propagation and user scope. No auth runtime change was needed.

## Verification design

The browser regression holds animation frames while actual React pages load fixture data, at desktop and phone widths. Pending responses still show loading, resolved billing actions must have fully visible ancestors, and the real detail action must issue its read. The previous animation wrappers fail the visibility assertion at both widths. Existing visibility-prefetch, Inventory cache reuse, cancellation/shared-consumer/session isolation and response-body deadline tests remain in the same suite.

Timing compares the previously built optimization candidate with the new presentation candidate. Both use the same current Portal API and PrepShip producer against the same local PostgreSQL fixture database. This isolates presentation from the earlier query/database changes. Production bundles use offline identity/provider boundaries, mounted native GET routes, real local authorization and audit writes. The unchanged PrepShip margin endpoint supplies companion measurements.

Version order alternates. Cold application loads restart API processes and browser contexts; PostgreSQL buffers are not reset. One-user scenarios use 50 warm paired rounds; four-user scenarios use 13 paired bursts, or 52 warm loads per version.

## Results

**412 warm page loads and 26 separate cold application observations completed**, including an unchanged-code repeat of the initially flagged small-data scenario. All native page requests, canonical parity assertions, scope checks and audit-write assertions passed; there were no request errors or outstanding work at settlement. Browser first-visible and complete times below are median / p95 milliseconds. Completion includes the drill-in and background reads, not just the summary row.

| Billing dataset / users | First visible, before → after | Complete, before → after | Companion p95, before → after |
|---|---|---|---|
| Small / 4, first run | 828.2 / 1262.5 → 481.8 / 626.1 | 1670.8 / 2093.8 → 1401.3 / 1599.9 | 166.55 → 189.96 (**+14.05%**, flagged) |
| Small / 4, independent repeat | 761.1 / 1196.3 → 477.4 / 652.6 | 1689.9 / 2385.9 → 1304.0 / 1717.7 | 200.01 → 202.96 (+1.48%) |
| Large / 1 | 253.3 / 477.0 → 193.8 / 315.3 | 1361.2 / 1604.8 → 1102.1 / 1262.2 | 115.03 → 113.22 (−1.58%) |
| Large / 4 | 916.5 / 9837.4 → 590.3 / 959.0 | 3017.3 / 12105.4 → 2619.7 / 2926.9 | 388.62 → 366.22 (−5.76%) |

The small-data repeat retained **37.27% lower median first-visible time**, **45.45% lower first-visible p95**, and **22.84% lower median complete time**. The original companion increase above 10% did not reproduce with identical code, scopes and settings. Both runs remain in the evidence; this is not a claim that the first run passed or that every host will have identical timing.

Large/four-user baseline burst 9 contained four roughly 9.6–10.0 second first-visible observations. Its invoice-summary responses themselves took 9.2–9.5 seconds, with a PrepShip event-loop maximum of 6.8 seconds and pauses in the Portal/harness too. **Do not attribute that dramatic p95 difference solely to removal of animation.** It is a shared-host/backend-pause limitation in this run. The unchanged backend on both sides, the repeat small-data result, and the held-animation-frame regression provide the clearer evidence for the presentation repair. All outlier samples are retained.

Per-page request medians and p95 stayed at **10** in every comparison. Response bytes stayed at **130,559** for small fixtures and **221,941** for large fixtures. Median instrumented database query count stayed at **40**; large/one-user baseline p95 was 41 and the remaining query-count p95 values were 40. No rows or required requests were removed to obtain faster visibility. Per-query timing, connection acquisition, companion samples and cold observations are retained in the hashed archives. Summed after-acquisition timings include driver/network/application scheduling; they are not isolated PostgreSQL execution time.

The companion is sampled throughout each page workload, so faster pages contain fewer companion observations rather than padded idle work. Four-user samples are clustered in paired bursts. These are local Windows/Node 20/PostgreSQL 17 measurements with offline providers; they do not establish Linux or production latency. The previous report's separately verified Node 26 driver compatibility is unchanged.

## Checks and evidence

All of these final Portal commands passed:

- `typecheck`, `build:web`
- `guard:client-portal-architecture`, `test:client-portal-shadow-renderer`, `test:client-portal-contract-drift`
- `test:portal-query-session-scope`, `test:frontend-auth-cache`, `guard:portal-scope-fail-closed`
- `test:billing-client-scope`, `test:client-portal-billing-totals`, `test:cp-059-canonical-billing-render`
- `test:client-portal-client-nav-connections`, `test:shared-db-boundaries`
- `test:cp-059-billing:browser` (6 cases), `test:shared-db-reads:browser` (5 cases)

The final visibility test was also run against the old presentation components: exactly its two visibility cases failed and the other three cases passed. Restoring the candidate made all five pass. The built native Billing screen was visually inspected. Test development corrected initial harness assumptions about responsive-role counts and development-mode request counts; these were not runtime repairs.

PrepShip `test:shared-db-native` passed for both the initial measured grid and the independent repeat (465.168 seconds and 119.868 seconds). It rechecks canonical billing events, all-field old-owner parity, supported sorts, totals, identities, Orders DTOs, and margin/analytics behavior against the local fixtures before measuring pages.

PrepShip runtime/package source hashes still match the previously passing full-SOT candidate, clean local snapshot **749c2c79d833994cb26cccbd8f79da77bf8f5abd**. Its full SOT guard pack and typecheck results remain applicable; no PrepShip runtime code changed here. Portal source comparison against the prior measured bundle found exactly the three presentation files listed above. Their current hashes match the new measured build. The updated guard and browser test hashes are recorded separately.

- [Verification status, source hashes and log archives](shared-db-evidence/render-followup-status.json)
- [Small-data first run](shared-db-evidence/browser-pages-small-recheck-render-first.json)
- [Small-data unchanged-code repeat](shared-db-evidence/browser-pages-small-recheck-render.json)
- [Large-data comparison](shared-db-evidence/browser-pages-large-recheck-render.json)

Each summary links a gzip archive with SHA-256 hashes for both compressed and original raw data. The raw rendering files' explicit `comparison` and per-build `apiVersion: candidate` identify this follow-up's owners; the generic harness notes also describe the earlier full-grid methodology. Older reports and their failures remain historical evidence.

Reproduce with the offline build helper `scripts/shared-db-build-render-followup.mjs` in a fresh artifact directory, then the loopback-only runner with `SHARED_DB_PARITY_ONLY=1`, `SHARED_DB_EXTENDED=1`, `SHARED_DB_PAGES=1`, `SHARED_DB_PAGE_RECHECK=1`, and `SHARED_DB_PAGE_RENDER_RECHECK=1`. Add `SHARED_DB_PAGE_DATASET=small` for the repeat. Preserve prior raw results before repeating. `scripts/shared-db-render-evidence.mjs` archives the completed raw runs and passing receipts; it deliberately refuses already summarized input.

## Handoff

The remaining first-visible tradeoff is addressed in the tested local candidate. Review the three-file presentation diff, the initial companion flag and its repeat, and the large-data outlier limitation before rollout. Deployment sequencing remains PrepShip's backward-compatible billing producer before the Portal consumer; roll back consumers first. No database conversion is required.

Final cleanup found zero remaining fixture client connections and stopped the local PostgreSQL server cleanly. All 21 archived verification/sample files passed compressed/original SHA-256 and cross-repository-copy checks; current runtime and test hashes matched the recorded candidate.

No push, deployment, merge, migration, index, hosting/pool increase, production repair, live provider probe, purchase or printing is authorized or performed.

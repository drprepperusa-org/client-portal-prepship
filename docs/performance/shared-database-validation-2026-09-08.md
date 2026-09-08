# Shared-database optimization — extended validation, September 8, 2026

> Current follow-up: [allocation repair, final checks and remaining review tradeoff](shared-database-final-followup-2026-09-08.md). This earlier report preserves its original measurements and historical limitations.

**Release certification remains open.** This pass added offline measurement infrastructure and evidence only. Application source hashes still match the previous manifest and the PrepShip source verified by the passing SOT snapshot `cd1975494a966aac75caa6303f991f009166b2c1`. No push, deployment, merge, production write, provider probe, purchase, printing, schema migration, index, or capacity change occurred.

## Separate-process shared-database measurements

Both application owners run in separate loopback HTTP server processes against the same native PostgreSQL fixture. Each process uses one main application pool with its existing default limit (PrepShip 4, Portal 10). Baseline and candidate alternate in 50 paired iterations with one or four primary callers and an unchanged companion request. An initial companion p95 increase over 10% triggers two further paired rounds; every round is retained. Timing includes HTTP and JSON parsing.

Data parity passed across all seven measured workflows. All completed requests had zero outstanding queries and zero query errors. The driver instrumentation counts nested queries and distinguishes connection acquisition from work after acquisition. Its negative control held the only connection for 50 ms: the second query waited about 55 ms, while the server sleep remained after acquisition. Failure, rollback, and connection reuse passed. Acquisition includes pool wait and first-use connection establishment; after-acquisition includes serialization, network, server execution and decoding, and is not a pure server-execution measurement.

Largest dataset, one primary caller; times are median / p95 in milliseconds:

| Workflow | Before | After | Local queries/read | Companion p95 change |
|---|---|---|---|---|
| prepship margin | 11.83 / 15.21 | 9.17 / 11.05 | 1.00 → 1.00 | -4.48% |
| prepship list | 85.14 / 104.19 | 83.83 / 100.41 | 8.00 → 8.00 | 6.42% |
| prepship detail | 15.15 / 21.77 | 9.15 / 13.12 | 19.00 → 12.00 | -1.81% |
| prepship full | 14.38 / 19.48 | 8.95 / 10.90 | 18.00 → 11.00 | -3.49% |
| portal billing | 553.07 / 585.72 | 451.04 / 489.98 | 1.00 → 1.00 | 12.46% |
| portal analysis | 37.78 / 40.36 | 31.48 / 33.53 | 3.00 → 3.00 | -7.71% |
| portal dashboard | 38.25 / 40.62 | 35.97 / 39.03 | 6.00 → 5.00 | -5.62% |

Portal Billing also makes 12 observed upstream PrepShip queries per read; its local count alone does not describe the complete workflow. Pagination still performs full-range canonical assembly. The small PrepShip Orders scenario is a three-row page over the 200-row fixture; the margin fixture stays at 300 candidates plus 10,000 historical rows. Portal small/large datasets contain 30/3,000 orders. These supplemental cases do not replace the original genuinely small native fixture cases.

## Performance gate

- OPEN: portal billing, large, 1 caller(s): companion pooled p95 16.14 → 18.15 ms (12.46%), across 3 round(s).

Stage-level follow-up for the large-range Billing case:

- baseline: companion HTTP p95 17.92 ms; owner p95 15.05 ms; acquisition p95 0.01 ms; after-acquisition p95 13.28 ms.
- candidate: companion HTTP p95 16.67 ms; owner p95 13.97 ms; acquisition p95 0.01 ms; after-acquisition p95 12.82 ms.

The attribution follow-up did not reproduce the pooled slowdown, and acquisition was about 0.01 ms at p95 in both versions. This fixture does not identify pool starvation as its cause. The earlier over-threshold result remains retained and unresolved; a later faster run is not a waiver. The next acceptance comparison should include the full application/browser workload with these stage timings before changing runtime scheduling.

## Built-browser measurements

The actual baseline/candidate production bundles render native Shipping Margin and Dashboard results from the shared local database. Authentication and unrelated shell endpoints are fixed offline fixtures. Browser visibility is recorded on animation frames for an in-viewport native result: the Billing account row or Dashboard top-SKU KPI. The second metric is two frames later, **not full-page completion or finished chart animation**. Fifty warm pairs alternate version order, preserve separate HTTP asset caches, and reset each page's React Query cache. Each load overlaps one companion owner request. Backend date/client scopes are fixed by the fixture; shell date controls are not exercised as filter-transition tests in this lane. Fresh-context browser samples are recorded separately, but backend processes are shared across versions rather than reset for matched cold-application runs.

| View / dataset | First useful before median / p95 | First useful after median / p95 | Two-frame median before → after | API requests before → after |
|---|---|---|---|---|
| prepship / small | 68.20 / 79.70 | 65.10 / 76.40 | 100.80 → 97.40 | 11.00 → 11.00 |
| portal / small | 140.30 / 203.30 | 138.00 / 197.70 | 239.30 → 233.00 | 8.00 → 7.00 |
| prepship / large | 81.10 / 105.30 | 77.00 / 105.80 | 113.30 → 107.30 | 11.00 → 11.00 |
| portal / large | 150.90 / 204.00 | 156.80 / 219.90 | 244.60 → 246.20 | 8.00 → 7.00 |

All corrected browser runs assert zero page errors, a valid Billing summary envelope, and zero outstanding API requests after speculative work settles. Earlier sequential browser results are retained as initial evidence but withdrawn from acceptance: they used automation polling timestamps, and the shell fixture used a legacy Billing summary envelope that correctly produced a controlled UI warning. The corrected paired lane timestamps visible results inside the browser and asserts that warning is absent. The prototype callback-helper failure and off-screen marker failure were harness defects, corrected without application changes.

## Installed production driver evidence

Read-only Render inspection still shows Portal building with `yarn` on main, one instance, unchanged service configuration. A build-log search for the installed postgres package returned no entries. A strict SSH attempt initially stopped on unknown host identity; a temporary local host file using [Render's published Oregon key](https://render.com/docs/ssh#renders-public-key-fingerprints) passed host verification, then failed with `Permission denied (publickey)`. No remote command executed and no SSH account/key or hosting setting was changed. Exact deployed driver identity remains unverified; source/lockfile version is insufficient evidence.

## Remaining work and reproduction

1. Resolve or explain with valid acceptance evidence the companion performance finding above; do not waive the specified 10% threshold.
2. Complete the full-page cold-application and concurrent-browser grid for Orders, Portal Billing drilldown and Inventory, including native shell/auth/audit paths. The two measured native widgets and existing functional browser guards cover part of this requirement, not all of it.
3. Obtain existing installation evidence or authorized read access for the deployed Portal driver.
4. Retain all existing business/security/release gates. Producer-before-consumer rollout remains mandatory and is not authorized by this validation request.

Use the existing safe runner with a loopback `SHARED_DB_TEST_ADMIN_URL` and `SHARED_DB_PARITY_ONLY=1`. Add `SHARED_DB_EXTENDED=1` for the separate-process grid; also set `SHARED_DB_BROWSER=1` for the browser lane or `SHARED_DB_CONTENTION_RECHECK=1` for the three-round Billing attribution lane. Run `node scripts/run-shared-db-checks.mjs test:shared-db-native`. Build isolated browser artifacts first with `node scripts/shared-db-build-frontends.mjs`; it deliberately refuses to overwrite an existing build checkout. The trace self-check is `node --import tsx scripts/shared-db-query-trace-check.ts`. Raw initial/final samples are retained beside compact summaries in gzip archives with hashes.

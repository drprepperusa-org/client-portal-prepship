# Shared-database native page validation — September 8, 2026

> Current follow-up: [allocation repair, final checks and remaining review tradeoff](shared-database-final-followup-2026-09-08.md). This earlier report preserves its original measurements and historical limitations.

This follow-up verifies the actual built Orders, Inventory and Billing pages through native mounted read routes on the same disposable PostgreSQL database. **Release certification remains open.** No application runtime files, production resources, connection limits, migrations, indexes, deployments, merges or pushes changed in this pass.

## Scope and controls

1224 warm page loads completed across baseline/candidate, small/large scopes and one/four browser users. Each single-user scenario has 50 paired warm rounds; each concurrent scenario has 13 paired four-user bursts (52 loads per version). Concurrent observations share a burst and must not be treated as 52 independent load generators. All browsers remained visible. Versions alternate and use separate HTTP caches; React Query state resets on each navigation.

Each cold burst uses a fresh browser context and restarts both API processes and their pools. PostgreSQL shared buffers and the operating-system file cache are not reset; these are cold application/pool loads, not a cold database or hosting boot test. The read servers mount the native routes and auth middleware without starting production workers. The Supabase identity endpoint, provider/rate catalog, queue/worker status and local-only readiness route are explicit offline boundaries. JWT signature verification, role/assignment/scope checks, canonical billing producer/consumer, inventory quantity reads and Portal audit inserts execute normally. Existing pool sizes and fixed transport are the same in both variants; this comparison isolates page/read changes, not the old broken driver.

The small scope has 3 assigned PrepShip orders, 30 Portal orders and 30 inventory SKUs; the large scope has 200 assigned PrepShip orders, 3,000 Portal orders and 3,000 inventory SKUs. Other fixture rows remain in the shared database. Browser business time is fixed at June 20, 2026, with actual query date parameters forwarded. Billing selects the populated May 1–15 period through the UI. API/server clocks and SQL now() remain real.

First useful result is timestamped by browser animation frames when a populated table row is visible. Complete result includes response bodies, speculative reads, visible results and the existing delayed exact Orders count. Billing completion includes the automated period-selection step. It does not mean all CSS/chart animations ended. Billing detail time runs from the automated row selection to visible canonical event rows.

The unchanged companion owner runs throughout each page load, with one request in flight and 50 ms between requests. Its p95 is calculated from all warm companion requests, without duplicating them for four-user groups. Database traces include local and upstream producer queries; acquisition includes connection establishment and pool wait, while post-acquisition includes network, server execution and decoding. Native Portal audit writes are asserted to persist. All measured page calls finished successfully with zero query errors and zero outstanding work at page settlement.

## Warm timing

Times below are median / p95 milliseconds, before → after.

| Page / dataset / users | First useful | Complete | Billing drilldown |
|---|---|---|---|
| orders / small / 1 | 74.30 / 90.70 → 70.80 / 88.30 | 2546.60 / 2561.80 → 2545.60 / 2559.80 | — |
| orders / small / 4 | 158.70 / 207.70 → 158.20 / 187.80 | 2572.10 / 2596.80 → 2576.90 / 2595.00 | — |
| inventory / small / 1 | 133.50 / 164.60 → 131.30 / 152.40 | 640.80 / 664.60 → 377.00 / 393.90 | — |
| inventory / small / 4 | 309.50 / 792.90 → 241.70 / 418.30 | 693.40 / 792.90 → 418.80 / 447.60 | — |
| billing / small / 1 | 120.40 / 159.10 → 123.20 / 150.00 | 665.70 / 698.20 → 613.60 / 693.20 | 470.40 / 572.40 → 468.90 / 580.60 |
| billing / small / 4 | 238.00 / 343.00 → 263.70 / 469.30 | 952.60 / 1079.20 → 931.20 / 1176.60 | 672.00 / 866.80 → 630.80 / 835.50 |
| orders / large / 1 | 122.80 / 145.30 → 123.70 / 144.60 | 2563.50 / 2583.30 → 2561.90 / 2577.00 | — |
| orders / large / 4 | 254.90 / 309.40 → 246.00 / 292.10 | 2624.30 / 2665.40 → 2616.90 / 2649.10 | — |
| inventory / large / 1 | 173.10 / 225.30 → 170.60 / 215.80 | 652.60 / 689.50 → 383.40 / 413.90 | — |
| inventory / large / 4 | 316.20 / 760.70 → 310.60 / 612.30 | 719.60 / 760.70 → 435.80 / 612.30 | — |
| billing / large / 1 | 150.20 / 171.50 → 152.30 / 199.80 | 1416.10 / 1449.10 → 1116.40 / 1257.10 | 1075.70 / 1187.60 → 964.80 / 1082.40 |
| billing / large / 4 | 280.80 / 512.80 → 372.20 / 805.80 | 2952.30 / 3363.40 → 2687.30 / 2957.50 | 2601.20 / 3113.70 → 2319.90 / 2630.30 |

## Request cost and companion application

Bytes count application API response bodies, excluding static assets and the internal trace envelope. Query counts include upstream canonical producer work. Cached database readiness probes and audit writes are included when requested by the page.

| Page / dataset / users | API calls/load | API bytes/load | DB queries/load | Companion p95 ms |
|---|---|---|---|---|
| orders / small / 1 | 18.00 → 18.00 | 109322 → 109322 | 26.48 → 26.42 | 13.13 → 13.05 (-0.60%) |
| orders / small / 4 | 18.00 → 18.00 | 109322 → 109322 | 26.17 → 26.06 | 16.07 → 16.03 (-0.27%) |
| inventory / small / 1 | 9.00 → 7.00 | 121054 → 106072 | 26.12 → 19.00 | 13.56 → 13.29 (-2.01%) |
| inventory / small / 4 | 9.00 → 7.00 | 121054 → 106072 | 26.15 → 19.00 | 17.04 → 17.43 (2.29%) |
| billing / small / 1 | 11.00 → 10.00 | 130643 → 130559 | 43.08 → 40.04 | 13.27 → 13.39 (0.91%) |
| billing / small / 4 | 11.00 → 10.00 | 130643 → 130559 | 43.31 → 40.00 | 17.76 → 17.51 (-1.44%) |
| orders / large / 1 | 18.00 → 18.00 | 1754474 → 1754474 | 26.48 → 26.42 | 42.55 → 42.92 (0.85%) |
| orders / large / 4 | 18.00 → 18.00 | 1754474 → 1754474 | 26.12 → 26.12 | 58.84 → 58.86 (0.03%) |
| inventory / large / 1 | 9.00 → 7.00 | 191618 → 141356 | 26.12 → 19.00 | 14.62 → 15.06 (3.00%) |
| inventory / large / 4 | 9.00 → 7.00 | 191618 → 141356 | 26.31 → 19.00 | 18.78 → 18.32 (-2.45%) |
| billing / large / 1 | 11.00 → 10.00 | 222025 → 221941 | 43.14 → 40.00 | 57.11 → 71.07 (24.44%) |
| billing / large / 4 | 11.00 → 10.00 | 222025 → 221941 | 43.23 → 40.02 | 497.80 → 440.04 (-11.60%) |

New companion observations above the specified 10% threshold:

- billing, large, 1 user(s): companion p95 +24.44%.

The earlier +12.46% owner-only companion finding and its non-reproducing attribution follow-up remain in the prior report. This workload adds evidence; it does not erase earlier samples or grant a performance waiver. Any new over-threshold observation above needs repeatability analysis before certification.

## Cold application samples

These are individual samples from one cold burst, not cold-load median/p95 estimates.

| Page / dataset / users / version | First useful ms | Complete ms |
|---|---|---|
| orders / small / 1 / baseline | 667.90 | 2668.40 |
| orders / small / 1 / candidate | 648.60 | 2655.50 |
| orders / small / 4 / baseline | 862.00, 842.70, 858.60, 810.20 | 2720.70, 2721.50, 2711.70, 2715.20 |
| orders / small / 4 / candidate | 868.00, 843.60, 802.30, 865.30 | 2727.20, 2724.70, 2719.90, 2722.70 |
| inventory / small / 1 / baseline | 313.00 | 843.10 |
| inventory / small / 1 / candidate | 300.30 | 538.90 |
| inventory / small / 4 / baseline | 732.70, 687.30, 635.60, 779.80 | 888.40, 885.90, 893.20, 894.60 |
| inventory / small / 4 / candidate | 740.00, 739.60, 661.00, 471.00 | 740.00, 739.60, 661.00, 563.90 |
| billing / small / 1 / baseline | 295.10 | 977.80 |
| billing / small / 1 / candidate | 313.90 | 913.80 |
| billing / small / 4 / baseline | 675.80, 591.80, 675.10, 591.30 | 1085.50, 1262.20, 1084.80, 1165.60 |
| billing / small / 4 / candidate | 697.70, 697.40, 608.90, 608.80 | 1066.80, 1205.90, 1205.20, 1180.80 |
| orders / large / 1 / baseline | 1108.90 | 3053.90 |
| orders / large / 1 / candidate | 1005.00 | 2991.40 |
| orders / large / 4 / baseline | 921.70, 936.40, 909.80, 868.60 | 2763.50, 2778.10, 2737.00, 2747.70 |
| orders / large / 4 / candidate | 988.10, 884.40, 920.70, 939.80 | 2759.30, 2731.10, 2744.60, 2788.60 |
| inventory / large / 1 / baseline | 714.90 | 1153.20 |
| inventory / large / 1 / candidate | 597.50 | 781.40 |
| inventory / large / 4 / baseline | 655.20, 690.10, 732.20, 777.80 | 931.20, 936.20, 948.80, 943.20 |
| inventory / large / 4 / candidate | 751.40, 841.30, 702.10, 798.20 | 751.40, 855.20, 848.10, 834.40 |
| billing / large / 1 / baseline | 495.60 | 1809.90 |
| billing / large / 1 / candidate | 375.80 | 1564.00 |
| billing / large / 4 / baseline | 752.10, 751.80, 751.40, 791.40 | 3570.50, 2397.30, 3319.80, 3226.70 |
| billing / large / 4 / candidate | 763.10, 590.50, 796.20, 762.30 | 3079.90, 3079.40, 2994.20, 2993.60 |

## Remaining certification limits

- Exact installed production Portal driver identity is still unverified: the prior Render build-log lookup returned no evidence and read-only SSH was denied. Source/lockfile identity cannot stand in for an installed package check.
- Performance flags must be evaluated without waiving the 10% criterion. The raw timings and clustered concurrent samples are retained.
- Existing source-of-truth, scope, cancellation, failure-recovery, billing parity and shipping safeguards remain required. This page lane adds successful-load coverage; it does not replace earlier cancellation and fail-closed guards or test live carrier speed.
- Producer-before-consumer release order remains required. Push, deployment and merge are not authorized by this validation task.

Reproduction: use the existing safe runner with loopback SHARED_DB_TEST_ADMIN_URL, SHARED_DB_PARITY_ONLY=1, SHARED_DB_EXTENDED=1, SHARED_DB_PAGES=1 and SHARED_DB_PAGE_DATASET=small or large. Run node scripts/run-shared-db-checks.mjs test:shared-db-native. SHARED_DB_PAGE_SMOKE=1 produces setup checks only and is not performance acceptance. Build artifacts are those already verified from the unchanged runtime sources. Raw final samples are stored as hashed gzip archives beside the compact summaries.

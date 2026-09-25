# Analysis chart loading — 2026-09-25

## Problem and placement

Analysis eagerly imported Recharts and the shared Charts module. The production
route module therefore waited for the chart library before mounting: its data
request, search, KPI cards, and SKU table all waited on optional visualization code.
Even an empty result downloaded that code.

This is frontend loading ownership in `portal-client/src/pages/Analysis.tsx`, not
a change to business data. The existing Analysis APIs, canonical sales metrics,
scope and financial redaction remain authoritative. No backend, cache, query,
ranking, total, freshness policy, or user workflow changes are needed.

## Change

- Load the existing top-SKU chart lazily only in its populated branch.
- Move the unchanged SKU bar-chart presentation to `SkuSalesChart.tsx` and load
  it only when the open SKU drawer has daily sales.
- Reuse `DeferredChart` for dimensioned loading and local failure/reload handling.
  Generalize its error copy from dashboard data to page data.
- Extend the existing production-build browser suite, already enrolled in CI,
  with Analysis coverage on desktop and mobile.

## Measured result

Baseline: official `main` commit `77fcc1eaac17c09192b1ec43ab55bf08138890a1`.
The browser proof holds the chart-library request unresolved. It establishes
dependency ordering instead of depending on machine-specific millisecond limits.

| Observation | Before | After |
| --- | --- | --- |
| Analysis API requested while chart download is held | No | Yes |
| Search available while chart download is held | No | Yes |
| SKU detail data usable while chart download is held | Blocked by page loading | Yes |
| Chart-library requests for empty Analysis | 1 | 0 |
| Failed chart download | Prevents route completion | Table remains usable; local reload control |

The baseline charts chunk was 394.46 kB raw / 111.45 kB gzipped according to Vite.
That unnecessary download is avoided for empty Analysis. Populated charts still
download their library; this is not a claim that the library was removed or that
total application size shrank. Existing bundle budgets pass with unchanged limits.
These are local production-build measurements, not measured production latency.

## Verification

- Baseline browser measurement: 4 passed across desktop/mobile; 2 new failure-
  isolation cases explicitly skipped because the baseline lacks that boundary.
- Candidate production loading suite: 16/16 passed, including all existing
  Dashboard checks, Analysis data-table accessibility, SKU chart values, empty
  results, held downloads, failed downloads, and recovery.
- Existing Analysis search/pagination/retry/browser suite: 3/3 passed.
- `npm run typecheck`: backend and active frontend passed.
- Production build and unchanged bundle budgets passed.
- `npm run test:guards`: all 189 guards passed, including full-site certification.

No production data, credentials, providers, labels, billing, or PrepShip checkout
were changed. Browser tests use intercepted API/auth fixtures. Existing uncommitted
work remains in the original checkout; this change uses an isolated worktree from
official main. Merge and production deployment are separate from this optimization.

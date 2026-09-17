# Dashboard chart loading performance — 2026-09-17

## Scope and release state

Local Client Portal frontend optimization only. No deployment, database changes,
business-calculation changes, or changes to the blocked PrepShip rollout in this pass.
Backend Dashboard DTOs remain the sole owners of totals, daily values, and ranking.

## Observed bottleneck

The Dashboard and its always-mounted KPI peek shell statically imported Recharts
components. Additionally, Vite 8 / Rolldown's previous manual chunk grouping pulled
shared React dependencies into the charts chunk: the compiled React entry depended
on charts. Consequently, even signed-out entry and hidden/empty dashboard charts
downloaded that library. Merely lazily importing Dashboard charts was insufficient.

## Change

- Give the React dependency group higher priority than optional visualization groups
  using Rolldown's supported `codeSplitting.groups` configuration.
- Lazily import main charts only when their existing populated/visible branches render.
- Lazily import the KPI trend inside the existing modal, preserving its shell and actions.
- Keep loading and errors local to each chart with a dimensioned skeleton and error
  boundary. The recovery button reloads the page; existing stale-bundle automatic
  recovery remains unchanged.
- Keep existing data mapping, source-of-truth ownership, filters, and drill-downs intact.

## Evidence

Production-build browser tests hold the charts chunk unresolved. Before this change,
neither Dashboard API loading nor the KPI controls became available. Afterward, both
are available before releasing the chunk. This tests dependency order rather than
relying on a machine-specific timing threshold.

Hidden and empty dashboard charts previously requested the charts library once;
they now request it zero times until the user explicitly opens a KPI trend.

Local bundle comparison (bytes; gzip measured by the existing budget guard):

| Measurement | Before | After |
| --- | ---: | ---: |
| Largest JS chunk, raw | 720,519 | 414,083 |
| Largest JS chunk, gzip | 209,151 | 116,843 |
| Total JS, raw | 1,874,610 | 1,877,304 |
| Total JS, gzip | 521,133 | 519,052 |
| Signed-out entry transfer, five-run average | 389,643 | 268,142 |
| Signed-out entry encoded body, five-run average | 386,943 | 265,442 |

The main improvement is deferring unnecessary chart code, not removing the library
from the application. These are local measurements, not a claim about production
latency. Total raw JS increases slightly from the extra loading boundaries/chunks.
Existing bundle budgets were not increased.

## Verification

- `npm run test:guards`: all 187 registered guards pass, including the existing
  portal UI suite, billing mutation checks, and full-site certification. Mutation
  fixtures were restored by their harnesses.
- `npm run test:client-portal-dashboard-loading:browser`: 10 passing cases across
  desktop and mobile, served from a real production build. Covers signed-out routes,
  held download/KPI independence, hidden/empty charts, chart data and drill-downs,
  failed downloads, and manual recovery. API/auth fixtures are deterministic and
  external requests are intercepted; no production credentials are needed.
- `npm run typecheck`: API and active portal pass.
- Dashboard full-scope, SOT, customization/RBAC, top-SKU, drill-down, client filtering,
  client scope, date-range, and KPI peek guards pass.
- Architecture, sales-SOT drift, analytics parity, shadow-renderer, bundle redaction,
  and unchanged bundle budgets pass.
- `npm run perf:web`: five-run signed-out entry measurement on the active portal.
- `git diff --check`: passes.

The production-browser proof has its own Playwright config and CI step. The default
development-server suite excludes that file because development modules cannot prove
production chunk boundaries. `DASHBOARD_PERF_BASELINE=1` permits the controlled
dependency/hidden/empty checks against the pre-change production build; the new
failure-isolation case is skipped in that mode.

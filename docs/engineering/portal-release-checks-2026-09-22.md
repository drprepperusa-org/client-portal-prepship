# Restore complete portal release checks

## Placement contract

Outcome: remove the confirmed source-formatting and obsolete CP-054 assertion
failures so CI can reach all existing browser steps. No guard is skipped, removed
from the runner or permitted to fail. Verification must run the full static suite
and every configured CI browser flow, then confirm hosted CI and integration.

The obsolete assertion requires a Topbar sync panel intentionally removed by
commit a156ad5. The current shell delegates to AttentionBell and its scoped
backend-owned /attention contract. CP-054 continues checking the canonical
integration DTO, connection-status policy, masking, failure propagation, tenant
scope and /sync-status aggregate contract. Its shell assertion should target the
current consumer instead of reinstating the retired panel. Update stale consumer
references in the source-of-truth docs. Audit date label is reformatted only; its
local timezone and exclusive-end formatting remain unchanged.

Owners: scripts/client-portal-connections-cp054-guard.ts and the current shell
consumer; source-line-length guard policy remains unchanged. No DB/schema,
provider, dependency, API, environment or business calculation change. Existing
main/live authorization applies. No PR. Rollback is a commit revert.

## Browser configuration correction

The complete browser run exposed a previously unreachable Connections failure:
Rename never became stable because decorative card animation ran continuously.
Playwright Test 1.60 accepts reducedMotion under contextOptions, not as a
standalone test.use option. Correct the existing reduced-motion declarations
in the eleven affected specs and dashboard production config. Keep real clicks,
timeouts and assertions; verify the media preference in the Connections scope
regression. Product animation behavior is unchanged.

## Local validation

- All 188 release guards passed, including full-site certification (typecheck,
  production build, bundle/redaction checks, portal smoke and complete UI suite).
- Browser validation after the configuration correction: 105 main browser tests,
  10 production-dashboard tests (desktop/mobile), and 51 table/smoke tests passed.
  CP-061/062/069 flows also passed in the complete UI suite run by the guards.
- Final diff check and the 857-file source-line-length check passed.
- Hosted CI, integration and deployment verification: pending push.

Run browser suites sequentially with the guard suite: mutation harnesses inside
that suite temporarily modify source files and restore them after verification.

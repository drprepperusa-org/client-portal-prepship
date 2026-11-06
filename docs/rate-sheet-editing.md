# Rate sheet editing

Admins use Settings → Access → select a client user → Edit → **Allow adding and editing rate sheets**. The grant is off by default and is stored in admin-owned Supabase app metadata as `rate-sheet:write`. It never adds broad financial or settings permissions. Grant/revoke requires a fresh active admin lookup and the existing mandatory access audit.

The Rate Sheet gets its editing capability from PrepShip. Authorized users can add/edit service rates, edit an existing client box price, or add a priced box. Each request forwards that user's bearer token to `/billing/rate-sheet/*`; no privileged service token is substituted.

PrepShip's `rate-sheet-access.ts` verifies current metadata and assigned clients on every save. `rate-sheet-commands.ts` delegates to `billing-rate-configuration.ts` and `billing-package-box.ts`. Those owners write shared `billing_config` / `client_package_prices` tables with required transactional audit. PrepShip's existing pricing editors use the same owners. Neither frontend calculates authoritative pricing, and no portal-specific rates table exists. Refresh either app to see saved rates; historical invoice lines are not regenerated.

User input and stale JWT grants are the entry points for invalid data. Backend field/precision validation, live grant checks and client/package scoping fail closed. React only collects values and displays backend results. Unrelated legacy zero-price package associations remain hidden; deliberately added free boxes remain visible.

Proof: `npm run test:rate-sheet-permissions`, relevant-package scoped-read test, existing access/architecture guards, and `web/e2e/client-portal-rate-sheet.spec.js` (admin switch, service and box saves, denial, client filtering, mobile). All mutation tests use disposable fixtures; no production grants or pricing were changed while implementing this feature.

Release PrepShip backend before the portal. Until the upstream capability endpoint is ready, the portal stays read-only.

## Local verification, 2026-11-07

Both builds and typechecks pass. The new permission/proxy tests, client-price isolation tests,
and seven Rate Sheet/admin browser scenarios pass. PrepShip's configuration transaction tests
cover immediate revocation, cross-client denial, audit rollback, explicit free boxes and
publishing a client price over an inherited catalog default.

The full Client Portal release suite is not green on the existing base: its inbound
customization guard still assumes admin-only columns, its export guard expects the older
CSV-only expression, the integration wiring check omits the monthly-period suite, and
Returns exceeds the existing function-size limit. The older portal-wide browser suite
also fails. Those unrelated surfaces were not changed for rate editing. No production
deployment, account grant or price mutation has been performed for this feature.

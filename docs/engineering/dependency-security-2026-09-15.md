# Portal dependency security update — 2026-09-15

## Scope and source

Update the portal API/tooling and active frontend dependency trees from main
20b78c255f0b6f906341733c21274be5f2298434. Business rules, DTOs, tenant scope,
billing/inventory owners and the pinned postgres 3.4.9 compatibility patch are
unchanged. The only application edit removes BrowserRouter's obsolete v6 future
flags: those behaviors are already the defaults in v7.

GitHub showed 42 open advisories, including historical version matches. Fresh npm
audits of the committed locks found 12 affected dependency entries in the root
tree and 7 in portal-client; these are different counting units, not 19 separate
exploitable production flaws. Both full-tree audits report zero known
vulnerabilities after this update and clean installs.

## Versions

| Dependency | Before | After |
| --- | --- | --- |
| Hono | 4.13.0 | 4.13.7 |
| Hono Node adapter | 1.19.14 | 1.19.17 |
| Root React Router DOM | 7.18.1 | 7.18.3 |
| Active frontend React Router DOM | 6.30.4 | 7.18.3 |
| Root / frontend PostCSS | 8.5.10 / 8.5.16 | 8.5.28 |
| shell-quote | 1.8.4 | 1.9.0 |

Compatible lockfile updates also patch browserslist, baseline-browser-mapping,
brace-expansion, nanoid and postcss-selector-parser, with their supporting browser
data packages. No forced npm audit fix was used. The latest router v6 patch was
checked but still matched two advisories; v7 is necessary to clear those matches.
The portal already opted into v7 startTransition and relativeSplatPath behavior.
It uses BrowserRouter and explicit routes, not the RSC or SSR modes named by some
router advisories. Alert removal does not prove that every former advisory was
reachable, or that an audit can identify every possible vulnerability.

Primary references:

- https://github.com/honojs/hono/releases/tag/v4.13.5
- https://github.com/honojs/node-server/security/advisories/GHSA-frvp-7c67-39w9
- https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
- https://github.com/remix-run/react-router/releases/tag/react-router%407.18.3

## Reproducible deployment

Vercel's install command becomes `npm ci && npm --prefix portal-client ci`.
The portal Render API build command must become `npm ci` (previously `yarn`,
without a committed yarn.lock). Start command stays `npm run start`. These commands
install the reviewed npm locks and execute the existing database-driver postinstall
check. No migration, environment secret, worker or production business-data change
is required. Rollback is the prior compatible frontend/API commit and its locks;
`npm ci` also supports that prior commit.

## Verification

Clean npm installs, typecheck, production build and both dependency audits pass.
All 185 static-suite entries pass, including full-site certification, login/auth
wall smoke, portal UI/audit flows and 39 billing negative controls. All 16 database
integration suites pass against disposable local PostgreSQL, plus both native
database/return suites. The additional 36 billing/export/status/account-switch
browser checks pass, as do all four authenticated upstream contract parity gates.
Tests used local fixtures and mocked providers; no live business data was changed.
Production release IDs and health results belong in the release receipt.

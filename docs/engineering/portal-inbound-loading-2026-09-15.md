# Inbound client-switch loading — 2026-09-15

## Placement and outcome

On page two of Received inventory, switching either the local or top-bar client
starts a request for the obsolete page before the reset effect runs. Desktop
regressions reproduce this for both selectors. Coverage also exercises the local
selector on mobile (390px), where the top-bar selector is not shown.

Use the existing `useFilteredPage` owner to reset request intent before fetching.
Success means exactly one page-one receipt request with the selected client,
immediate clearing of the old client's receipt rows, and verbatim display of the
new response's received quantity. Existing pagination/sort and retained-row tests
cover navigating within the same client.

## Canonical data and boundaries

`listPortalInboundReceipts` already reads its page and count concurrently. It owns
the receipt DTO: SKU from `inventory.sku`, receivedUnits from `inventory_ledger.qty`
where type is receive, receivedAt from effective_at then created_at. Its existing
inventoryScopePredicate and explicit client/store filters own visibility. No
operator identity is exposed. No backend, contract, scope or formula changes.

`useInboundReceipts` and `useTokenQuery` retain their existing session and client
query/cache boundaries. The frontend change is request intent only; receiving
commands, inventory mutations, expected-shipment handling and receipt dates are
unchanged. Tests mock network traffic and never receive real inventory.

## Release

Base/rollback: `a90829ebc66dcf7d2ea317539e0b236aabf253d9`. No migrations,
dependencies, environment or worker changes. Add the new proofs and existing
Inbound pagination tests to hosted CI. Deploy main under standing user authority,
then verify exact frontend/API commit, readiness and anonymous auth protection.

## Verification results

- Five focused Inbound browser tests pass: mobile local-client switch, desktop
  local/top-bar switches, sorted pagination, and retained rows while sorting.
- Contract drift and both typechecks pass.
- Inbound receipt canonical-source guard, table retention, session query scope,
  client/store scope, access-security and carrier/weight redaction guards pass.
- Both package manifest/lockfile dependency consistency checks pass.
- Full-site certification passes: production build/budgets, architecture,
  source-of-truth and bundle redaction, action/API contracts, label URL and print
  validation, 7 auth smoke tests, 41 portal UI tests and failure-state fixtures.
- Runtime diff is confined to Inbound request intent; the backend was inspected
  and already runs page/count concurrently. No backend performance change or
  production latency percentage is claimed.

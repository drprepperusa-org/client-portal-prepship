# Restorable Audit Log views

## Placement and outcome

The missing state enters when AuditLog mounts: component defaults used to replace
the user's selections. `useAuditView` owns URL-backed view intent: search, actor,
store, applied ISO date bounds, activity, background visibility and page. Reload,
browser history and copied links read that same owner before fetching. Filter
changes reset page atomically; search commits after 250 ms, one history entry per
settled edit. A subsequent filter change commits pending search with it. Back and
Forward cancel pending edits. Date drafts remain unapplied until Apply dates.

The unchanged audit API and database read-model own event data, classification,
store attribution, ordering, pagination and admin access. React only serializes
request intent and renders existing DTOs. Links convey no authority. Invalid known
link values reset with visible feedback; unknown fields never enter copied links.
Copies exclude fragments and arbitrary parameters. Clipboard denial exposes a
selectable link. Signed-out login navigation preserves the requested query string.

Date links preserve exact instants, including DST boundaries, even in another
timezone. Inputs and applied-range text display in the opening browser's timezone;
reapplying calendar dates explicitly replaces the bounds with local midnights.
Copied views are live queries, not frozen snapshots of the event rows.

## Verification and release

Browser fixtures cover combined-filter refresh, history, page resets, canceled
search, clipboard success/denial, different timezones, malformed links, missing
facet options and access denial. Existing audit runtime, scope, redaction,
contract and full-site checks remain required. No dependency, schema, API, worker
or production business-data changes. Base/rollback: 53e81e39c8f1c97bc562ddb8ad387a3af10790a8.
Push directly to main and verify Vercel/Render parity under standing authorization.

## Completed checks

- Eleven focused browser tests pass: existing investigation controls/retry plus
  saved-view refresh and copying at mobile/desktop sizes in Manila and Los Angeles,
  exact 23-hour DST bounds, history/page/search/date restoration, clipboard denial,
  malformed parameters, missing facet entries, denied capability and sign-in.
- Audit route runtime fixtures, contract drift, query/session isolation, client/store
  scope, access security, fail-closed scope, and carrier/weight redaction pass.
- API/portal dependency manifests match their lockfiles. No packages were changed.
- The hosted browser lane includes the new view and sign-in regressions.
- Full-site certification passes: both typechecks, maintainability/source guards,
  production build/budget, architecture/shadow-renderer, bundle redaction,
  action/API contracts, safe label/print guards, eight auth smoke tests, 41 portal
  UI tests and injected failure-state fixtures.

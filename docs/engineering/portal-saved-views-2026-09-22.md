# Saved filter views for Orders and Inventory

## User outcome

Save view captures the current search, status (Orders) or low/out toggle
(Inventory Stock Levels), sort and rows per page. Open saved view restores them
together and resets page 1. Manage views deletes saved entries. Names are limited
to 40 characters, searches to 120, and each user/client/page bucket to 20 views.
Duplicate names fail explicitly; nothing is silently overwritten.

Views are stored in this browser, per authenticated user, selected client filter
and page. They do not sync across devices. Current global date choices are not
saved: neither the Orders list nor Inventory Stock Levels uses those dates.
Inventory History is outside this change. No result rows or business data snapshots
are saved; opening a view uses the existing backend queries and CSV contracts.

## Placement and imperfect data

This is presentation intent only. Canonical Orders and Inventory read models,
tenant predicates, stock/status math and exports remain unchanged. The earliest
untrusted input is browser storage. `saved-views.ts` validates the version, page,
allowed filter and sort keys, page sizes, names and IDs. Scope IDs and arbitrary
API fields cannot enter through saved filter payloads. Applying a stored sort also
checks that its column is currently available to the user.

`SavedViewsBar` remounts by user/client/page, so a client switch closes its dialogs
and reads only that bucket. Browser storage is a convenience, never authorization;
the backend continues to enforce access. Writes re-read the current bucket and
other-tab storage events refresh the menu. Storage failure never reports success,
preserves save drafts and supports retry. Malformed storage is not overwritten.

`useSearchDraft` debounces typing but applies a saved search immediately with the
other view fields, cancelling a pending typing timer. This prevents a restored
view from being replaced by an old search draft. Explicit page reset prevents
restoring an obsolete page number. The existing export components keep using the
same query intent and disable download until pending data refreshes finish.

## Verification and release

Browser coverage verifies both pages, reload persistence, same-user client isolation,
other-user exclusion, fresh backend requests, matching CSV filters, first-page reset,
sorting and page size, duplicate names, deletion, storage failure/retry, malformed
scope injection, two tabs, keyboard dismissal and mobile containment. Existing
Orders/Inventory CSV and attention navigation tests remain regression gates.

The focused browser proof runs before the static guard suite so the existing
baseline guard failures do not skip it. No existing gate is removed or weakened.
There are no backend, database, provider, environment, or migration changes.
Rollback is a revert; browser entries remain inert when the controls are absent.

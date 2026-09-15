# Detailed portal audit activity

## Change and ownership

The Audit log now shows a backend-authored description, activity category and
recorded outcome. View details opens a responsive dialog with actor, second-level
timestamp/time zone, session scope, event ID and the recorded field values. Arrays
of IDs show their values rather than only their length. Automatic count/session
checks are distinguished from browser navigation and data requests.

The original gap enters when routes record only IDs/counts and the UI labels any
read as Viewed. The canonical owner is the persisted client_portal_audit_logs row.
The new audit-log-activity read model interprets the event stage and allowlisted
metadata; the frontend renders its PortalAuditActivity DTO. It cannot infer
successful writes, intentional clicks or missing historical values. Requested
actions remain Requested; legacy events without an explicit outcome stay Recorded.

Orders/inventory reads additionally record canonical response counts and requested
sorts. Order detail records its returned order number; billing reads record their
normalized day window. These additions affect future audit events only.

Admin capability checks and the existing activity-to-store selector are unchanged.
Read-time metadata sanitization protects historical secrets; detailed presentation
uses allowlisted fields and does not expose raw credential/provider payloads.
No new tables, migrations, provider actions or production data edits are required.

## Verification

- Typecheck and active portal production build passed.
- Architecture, shadow-renderer, contract-drift, auth coverage, access security and
  client-redaction guards passed.
- Audit suite passed: historical metadata sanitization, activity store attribution,
  detail projection and actual admin/non-admin HTTP DTO behavior using a query stub.
- Canonical orders, inventory status and billing totals guards passed.
- Desktop (1440px) and mobile (390px) browser proofs passed. Both screenshots were
  inspected; modal content wraps and scrolls within the viewport.

## Release

Prepared locally in the isolated portal-audit-details worktree from df7eeaa.
The original portal checkout's unrelated shipment edits were left untouched.
The initial details change was released as 9543f85 with portal production
authorization. Deploy the compatible backend and frontend together; the
optional activity DTO permits older API responses during rollout. Existing audit
rows remain intact on rollback.

## All-user history correction

A read-only production check confirmed that client activity was persisted under
the clients' own identities. The page only exposed the newest 100 events, with no
actor picker or older-page navigation. The backend now exposes distinct recorded
actor emails across history, an exact actorEmail filter and page/hasMore metadata.
All users remains the default. Store and text filters combine with the user filter;
the existing global-admin capability check protects both actor discovery and rows.
No historical activity, identity, role or unrecorded action is fabricated.

The UI passes filter/page intent and renders the backend response. Its cache key
includes user, store, search and page; a filter change returns to page one. The
page-one list refreshes periodically; older pages can be refreshed manually.

Verification: the audit runtime now uses actual in-memory PostgreSQL queries,
including 101 admin events followed by older client records, separate client
recording, exact actor selection, combined search and non-overlapping pages.
Typecheck, build, architecture, shadow-renderer, contract-drift, access security,
redaction and auth-coverage checks passed. Four desktop/mobile browser flows
passed; the user-picker and pagination screenshots were inspected.

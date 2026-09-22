# Notification dismissal by issue identity

## Problem and outcome

The bell persisted only category counts. Replacing an affected SKU or connection
with another while keeping the counts equal hid the new issue. Dismiss all now
stores the current backend issue keys. The badge shows undismissed items; Show
dismissed keeps still-unresolved issues accessible. Dismissing changes no stock,
connection, preference, or other business state.

## Placement and scope

`read-models/attention.ts` owns membership and issue identity. Inventory delegates
to the existing `portalInventoryWhere` selector and ledger quantity owner, reading
only IDs for the complete selection. Connections delegate to the existing scoped
store DTO and attention filter; their keys include the public status/reconnect
reason so a changed condition is new. No raw error, credential, or account identity
is exposed. Counts are the lengths of the same membership arrays, avoiding a
separate count/read race. Existing category preferences and tenant scope remain.

The unsafe entry point was the frontend's count-only persisted snapshot.
`useAttentionDismissals` replaces it with versioned user/client-scoped visibility
state. The UI neither classifies conditions nor resolves them. A successful fresh
read retires missing enabled-category keys. Failed reads and muted categories
preserve dismissals. Storage errors preserve in-memory behavior and display a
warning that reload persistence is unavailable. Old count snapshots are ignored.

## Limits

Dismissals remain local to this browser, as before. A current-condition read cannot
detect an issue that resolved and returned entirely between successful reads.
Inventory keys represent the same low/out condition for one row; changes of quantity
within that condition do not produce repeated notifications. No event-history table,
migration, job, environment variable, or production-data change is needed.

## Verification

The real disposable PostgreSQL test exercises full membership beyond page size,
equal-count replacement, canonical connection status changes, tenant disjointness,
disabled-category membership, and failures. Browser tests cover equal-count changes,
reload persistence, dismissed issue access, observed resolution/recurrence, muted
categories, failed refresh, legacy storage, denied storage, mobile containment, and
client isolation. Existing notification preference tests remain part of the gate.

The contract is additive for old frontends. New frontends treat responses lacking
identity arrays as unavailable rather than using unsafe count-only dismissal.
Rollback is a revert of this change; persisted visibility keys are personal UI state.

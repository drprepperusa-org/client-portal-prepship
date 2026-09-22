# Admin client activity summary

## Placement contract

Outcome: Audit log offers an admin-only, searchable, paginated client overview for the last 7/30/90 days. Each client shows the latest recorded non-background event, three recent action/navigation events, and explicit failed/denied event counts. Open audit history preserves the exact client and UTC time window. Clients without events remain visible.

Owner: client_portal_audit_logs at created_at, backend activity classification and a shared client-attribution selector. React formats DTOs and submits view intent only. Counts are event counts, not distinct operations, sign-ins, active users or online presence. Actors include staff as well as client users; recorded actor identity is shown.

Imperfect input: old/malformed metadata, broad session scope, missing resource ownership and unrecorded events. Explicit metadata/resource attribution takes precedence over singleton session scope. Broad unassigned events remain available in All clients audit history; they are not attributed to every client. Client/store labels and resource ownership use current canonical records, not reconstructed historical membership. Before/after values and unrecorded activity cannot be recovered.

Callers: new bounded summary read model and existing audit list/CSV share the same client predicate. Existing store filtering is unchanged. Admin capability remains canViewAudit (global only), checked before selectors; errors must never become zero activity. DTO events use sanitized, allowlisted PortalAuditActivity projection; raw metadata is not returned by the summary.

Verification: disposable PostgreSQL tests for attribution, dates, more than 100 events, pagination, absent events, malformed IDs and non-admin denial; browser tests for backend values, exact links, filters, loading/error/retry and mobile containment. Existing audit, scope, contract, redaction and source-of-truth guards remain enabled.

Live effects: authorized main push and automatic Vercel/Render deployment only. No production data mutation, provider operation, migration or new background poll. Rollback by reverting this commit.

## Local verification results

Four browser scenarios pass: summary/drill-down/CSV, search/period/pagination/mobile,
loading/error/retry, and non-admin redirect with no summary request. The real
PostgreSQL integration covers 125 failures beyond the audit page limit, timestamp
bounds, 28-client paging, resource and array attribution, malformed/overflow IDs,
explicit ownership over session scope, sanitized DTOs and database failure.
A disposable 10,000-event smoke query completed in 158 ms locally; this is not a
production latency guarantee. Desktop and mobile screenshots were inspected.

Build/typecheck and audit, architecture, contract-drift, access-security,
shadow-renderer, scope, bundle redaction and bundle budget checks pass. The known
source-line-length baseline failure in AuditInvestigationFilters.tsx remains.

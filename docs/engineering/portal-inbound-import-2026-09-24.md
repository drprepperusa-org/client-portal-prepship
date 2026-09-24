# Inbound CSV preview and reliable import

## Placement contract

- Outcome: preview all pasted rows, identify row-level client/quantity/date problems, preserve failed drafts and prevent duplicate batches on retry.
- Existing frontend CSV coercion and route loops silently default bad input, truncate data and permit partial commits. Remove these owners.
- Backend CSV parser owns syntax, authorized client-name/ID resolution, grouping by client plus reference, row validation and preview counts. React displays this preview and sends the exact CSV plus its preview fingerprint.
- Import service revalidates against current database clients and checks the preview fingerprint before saving. Headers, items and private retry records commit together. The existing private `portal_inbound_create_requests` table supplies one receipt per imported shipment, with a batch-specific hash and deterministic child request keys. No migration or public DTO exposure of receipt internals.
- Same actor/key and original payload replays the committed batch; changed payload, deleted shipments or revoked client scope reject. A new preview is required after CSV edits. Ambiguous failures retain and lock the original request for Retry import.
- Require a valid client, reference, SKU or name, nonnegative integer quantity and consistent shipment header per group. Dates use YYYY-MM-DD. Bounds: 1 MiB CSV, 5,000 item rows, 500 shipments, 200 items per shipment; report errors instead of truncating.
- No inventory movements, labels or provider notifications are part of this operation. Test only against disposable PostgreSQL and intercepted browser requests. Direct main deployment is authorized.

## Verification plan

Test CSV quoting/newlines/headers, row validation/grouping, scope and fingerprint freshness, all-or-nothing rollback, concurrent retries and replay after lost responses. Browser proof covers preview invalidation, errors, draft preservation, pending/uncertain protection, successful refresh and mobile layout. Run repository gates and verify both production commits.

## Local verification

- Typecheck, production build, 870-file source-line check and maintainability audit passed.
- All 189 repository guards passed, including full-site certification.
- All five import browser cases passed on repeated runs; mobile preview inspected at 390px with table scrolling contained in the modal.
- All 39 combined form/create/search/receive/import cases passed across runs. Two unchanged tests had intermittent local failures (return focus restoration and initial receive-page navigation); each passed a focused rerun. The hosted combined suite remains a release check.
- Disposable PostgreSQL integration passed: scoped read-only preview, malformed CSV and row errors, grouping conflicts on every affected row, row/batch bounds, six concurrent identical requests, changed-payload rejection, revoked access, deleted shipments, database rollback, changed client-name resolution, and a 501-item batch crossing the insert chunk boundary.
- Integration and browser checks are included in the existing hosted workflows. No real import or provider action was used for verification.

## Rollout and rollback

Frontend and API must deploy the same commit. Legacy import payloads fail closed and keep their pasted CSV; refresh after rollout to use the preview workflow. No new schema or configuration is required. Rollback reverts this commit on both services; existing private import receipts and saved inbound records remain intact. Retry safety applies to the retained original request, not a newly started import of the same CSV.

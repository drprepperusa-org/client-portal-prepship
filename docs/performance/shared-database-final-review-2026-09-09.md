> Repair update (2026-09-09): the local verification blockers below are resolved. See [the repair report](shared-database-review-repairs-2026-09-09.md) for the 182/182 guard result, native integration checks and remaining release boundaries. This report is retained as the historical finding record.

# Shared-database optimization — final review, 2026-09-09

## Verdict

**Combined release: blocked by Portal verification failures.** PrepShip has no new blocking application-code finding from this review, and its prior full-SOT evidence remains applicable. Portal's focused checks passed previously, but the broader required checks do not pass. This report supersedes any inference of release readiness from the earlier focused reports.

This is a local review of uncommitted changes in both `perf/shared-db-optimization` branches. PrepShip base is `dc3b243566d0296d7bb87056b8b27fb9e6d9a7a6`; Portal base is `164f5520b04c78241ae6edf529d58741c9258b76`. These are base commits, not commits containing the implementation. No exact release candidate has been certified.

## Required repairs

### 1. P1 — Native database tests are admitted to the database-free static CI lane

Portal `package.json:274` and `:277` introduce `test:database-pipeline:pg17` and `test:shared-db-native:returns`. `scripts/run-guards.mjs:26` does not classify them as fixture-dependent, so the automatic static discovery selects both. `.github/workflows/ci.yml:57` runs this suite without a PostgreSQL service or their required `RATE_PIPELINE_PG_ADMIN_URL` / `SHARED_DB_TEST_ADMIN_URL` configuration.

The local full static run reproduced both failures before database access. Classify these tests correctly and wire their execution into a disposable, explicitly configured integration lane. Keep the tests mandatory in that lane; removing coverage or supplying production credentials is not a repair.

### 2. P1 — Required CP-059 integration fixture violates the new pagination contract

`scripts/integration/client-portal-billing-cp059.integration.ts:82` stubs upstream responses as `{ data: rows }`, including requests for a specific page. The new consumer correctly requires pagination metadata from the canonical producer. After its first five cases pass, the existing suite fails at line 198: `paged reads must succeed`. Subsequent integration assertions are not reached.

This failure was reproduced with Node 20.19.0 and a freshly seeded disposable local PostgreSQL database. Update the fixture to honor requested page, size and ordering and return valid metadata and totals. Retain the 2+1 event identity/no-drop assertions, whole-range total parity, and explicit malformed-response rejection. Do not relax production validation or add a full-download fallback.

### 3. P1 — Existing structural guards were not carried forward with the refactor

The full static suite reports **166 passed / 18 failed**, exit 1, in 463.168 seconds. Two failures are the native-test wiring above; the other 16 commands include duplicated guard aliases and one mutation suite whose prerequisite guard is red. They are not 18 independently established product defects.

Inspected examples show assertions still requiring the old implementation shape:

- API guards require `token: string`; the cancellation-aware API now accepts `RequestAuth`. This affects store connection, audit, invoice export, returns and dashboard guards. The invoice-export guard also prevents the CP-068 mutation suite from establishing a green baseline.
- Orders badge and Inventory guards search for inline array keys; these now use the shared, user-scoped key factory. Verify the factory's page-size and tenant dimensions instead of deleting those assertions.
- The Connections guard requires the former `waitForForegroundQueries` helper name, although the new loop still waits for foreground reads and serializes speculative work.
- Sales/Top-SKU guards require a one-argument call to the canonical owner; the current call passes the bounded read executor and explicit output options.
- The return-identity guard demands Portal-local `all.length`; paginated totals now come from PrepShip's validated canonical response.
- Failure-state guards require the old error-handler expression verbatim. The new handler permits the fixed, controlled analytics-unavailable message. Add coverage proving arbitrary operational errors remain redacted and only the intended controlled response is exposed.

Update these guards to verify the preserved behavior and owner boundaries, including negative cases. Rerun the full static suite and affected mutation suites. The complete command list and failure output are archived below. No clean-base full-suite comparison was performed, so this review does not assert that every failing command is newly introduced or independently diagnose every hidden assertion after a failure.

## Verified evidence and limits

- PrepShip `test:shared-db-boundaries` passed again. Its measured runtime/package raw hashes still match the previously passing full-SOT snapshot `749c2c79d833994cb26cccbd8f79da77bf8f5abd`; that broad suite was not repeated unnecessarily.
- Both dependency manifests agree with their lockfiles, and installed/pinned PostgreSQL driver versions are 3.4.9. This is not a new clean installation.
- Portal measured runtime/package content matches the previous evidence after LF normalization. Current files use CRLF where that manifest used LF; byte hashes are therefore different. The new manifest records current raw hashes and distinguishes raw from normalized equivalence.
- The prior typechecks, active frontend builds, focused browser cases and measured performance reports remain historical evidence with their documented platform and outlier limits. They do not override the new failing gates.
- No new billing-calculation, tenant-scope, pricing, inventory-quantity or shipping-safeguard defect was established in this review. That is not production-runtime acceptance.
- The temporary CP-059 database was dropped; zero other fixture client connections remained, and the local PostgreSQL server started for this review was stopped cleanly.

The [review evidence manifest](shared-db-evidence/final-review-status.json) records branches, base SHAs, current source hashes, all 18 failing commands and four compressed logs with original/compressed SHA-256 hashes. Identical evidence copies are saved in both repositories. Earlier measurement reports and failures remain preserved.

## Next action and eventual release order

Repair the Portal test fixtures, CI classification and structural guards first; rerun the required gates without waivers. Then review any resulting implementation changes and bind the accepted evidence to committed candidate SHAs in both repositories. Additional functional changes require their affected parity/browser checks.

After separate push/deployment authorization, release the backward-compatible PrepShip billing producer before the Portal consumer. Verify API/worker/frontend commit parity and runtime health at that stage. Roll back the consumer before removing producer support; driver rollback requires a clean dependency installation. No data conversion is required.

This review made no application-code repair, push, merge, deployment, migration, index, hosting/pool increase, production data change, live provider call, purchase or printing operation.

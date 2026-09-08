# Shared-database optimization — review repairs, 2026-09-09

## Result

**The three local final-review blockers are resolved.** Portal's complete static suite now passes **182/182**. The two native database tests excluded from that database-free suite pass separately and are explicitly wired into a PostgreSQL 17 CI job. They have not been waived or deleted.

Both repositories remain on their uncommitted `perf/shared-db-optimization` branches. This is local verification and readiness for candidate review, not a claim of hosted CI success, deployment or production acceptance.

## Repairs and ownership

The failure entered through outdated verification fixtures and assertions. The repair changes Portal test scripts and CI configuration; application code and business ownership remain unchanged. PrepShip still owns canonical billing events, identities, ordering and whole-range totals. The Portal proxy still validates the producer response before its read model enriches presentation text. Backend scope, redaction and shipping safeguards remain authoritative.

1. **Native CI wiring:** `.github/workflows/integration-tests.yml` now has a separate PostgreSQL 17 job with disposable loopback configuration for the transport and return tests. The static runner excludes precisely those two native commands. The existing CI wiring guard verifies their job, environment and mandatory execution; negative fixtures reject missing steps, missing configuration, accidental static admission and failure waivers. The native return harness now creates a uniquely named database and only drops the database that invocation created.
2. **Billing pagination fixture:** the CP-059 integration mock now supplies the producer's requested page and metadata while preserving the unpaged response path. It verifies 2+1 rows across three events, unchanged whole-range totals, forwarded sorting, out-of-range pages and rejection of missing/mismatched/inconsistent metadata without a full-download fallback. All prior route, identity, redaction and return-money checks remain. The strengthened final fixture passed **27/27** against a fresh local database.
3. **Structural guard updates:** existing guards now recognize `RequestAuth`, shared user-scoped query keys, serialized prefetching, bounded canonical analytics calls and producer-owned pagination totals. Error-boundary coverage executes the real registration offline and proves ordinary 500/503 messages remain redacted while the fixed analytics-unavailable message is allowed. A deliberate error-exposure mutation is rejected. The export test uses a controlled timer and verifies the same deferred URL cleanup, avoiding a real one-minute test wait. Its original export-preservation assertions remain and all **11/11** export mutations are rejected.

The [evidence manifest](shared-db-evidence/review-repair-status.json) lists all 19 changed Portal code/config/test files relative to the preceding review, current hashes, command receipts and archived logs. PrepShip has no code/config/test changes relative to that review. Raw hashes of all 29 previously recorded Portal application/package files and all 15 PrepShip application/package files still match, confirming mutation-test restoration.

## Verification

Executed locally with Node 20.19.0, Windows and disposable PostgreSQL 17 fixtures; providers were offline.

| Check | Result |
| --- | --- |
| Portal full `test:guards` | 182/182, exit 0, 332.855 seconds; includes architecture, shadow-renderer, contract, scope, redaction, billing, analytics and mutation guards |
| Portal `typecheck` | PASS, 11.895 seconds |
| Portal `build:web` | PASS, 6.969 seconds |
| CP-059 Billing browser suite | 6/6 PASS |
| Shared reads, cancellation and visibility browser suite | 5/5 PASS |
| CP-068 invoice-export browser suite | 4/4 PASS |
| CP-068 mutation harness | 11/11 rejected; green baseline and restored sources |
| Native database transport | PASS for ESM/CJS, pool sizes 1/4, concurrent reads, transaction/savepoint rollback and reuse |
| Native return eligibility | 28 checks PASS; no provider, storage or postage calls |
| Final CP-059 billing integration | 27/27 PASS, including all formerly unreachable cases |
| PrepShip shared-database boundary | PASS again, 1.921 seconds |

Fourteen compressed logs and their raw/compressed SHA-256 hashes are copied into both repositories. The earlier failing review and its evidence are retained. Initial billing setup exercises the existing missing-reporting-table fallback before the suite installs its fixture reporting tables; subsequent materialized/non-materialized money assertions pass. These are local fixture operations, not production migrations.

No application code changed during these repairs, so the prior performance results and their platform/outlier limitations remain applicable; this report claims no new speed measurement. PrepShip's previously passing full-SOT snapshot `749c2c79d833994cb26cccbd8f79da77bf8f5abd` remains the applicable broad evidence. It was not rerun in this repair turn.

## Handoff

The local repair gate is green. The next release step is to review and commit the candidates, bind evidence to those exact SHAs, and obtain the required push/deployment authorization. The new workflow still needs actual hosted execution; a local pass is not an Actions pass, a clean Linux installation, or production-runtime certification.

Release PrepShip's backward-compatible billing producer before the Portal consumer. Roll back the consumer first; database-driver rollback requires a clean dependency installation. No data conversion is required.

Cleanup found zero remaining fixture client connections and zero databases from these test invocations; the local PostgreSQL server was stopped cleanly. No push, merge, deployment, production data change, live carrier request, purchase or printing occurred.

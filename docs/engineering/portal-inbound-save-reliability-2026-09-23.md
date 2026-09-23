# Reliable New Inbound saves

## Placement contract
- Outcome: header and item rows commit together; retries of one save return the same shipment; the confirmation identifies and opens the saved shipment.
- Canonical owner: a focused backend inbound-create service over inbound_shipments/inbound_items, with a private actor-scoped request-key receipt table. Existing receiving/import workflows remain separate.
- Injection point: independent header/item inserts and an ambiguous HTTP response after commit. A transaction covers all writes; a transaction-scoped advisory lock serializes the same actor/key, with a payload hash rejecting changed intent and a durable receipt surviving process restarts.
- Scope: existing global/settings:write permission plus client access applies before create and again to replayed records. The authenticated actor owns the key; no browser-supplied user identity. Deleted records leave a receipt tombstone and cannot be recreated by retry.
- UI: one key and immutable payload per uncertain attempt; retry repeats that attempt. A definitive validation rejection permits corrections. Saved confirmation uses the canonical PortalInbound DTO, never draft values as proof of persistence. Cache refresh failure must not turn a committed save into a retryable failure.
- Database: additive 0053 migration for a backend-only table, RLS enabled and anon/authenticated/PUBLIC grants revoked. Apply before runtime release; no production business rows are changed by migration or tests. Existing unkeyed callers remain compatible and gain atomic writes.
- Tests: actual PostgreSQL concurrency, rollback on item failure, replay after response loss, payload mismatch, actor/client scope, deletion, RLS/grants; browser retry and confirmation/open flow; existing form validation and unsaved-draft checks; full release gates.
- Main push and deployment are authorized by the ongoing request. No real receiving, inventory, postage, labels or marketplace calls are used for verification. Rollback reverts application code and retains the additive receipt table.

## Migration and verification
- Migration 0053 is handwritten and outside the Drizzle journal, like the repository's existing standalone migrations. Use `scripts/apply-portal-inbound-create-migration.ts`; it pins the SQL hash, checks the target project, applies within a short transaction and verifies the primary/foreign keys, index, RLS and grants. Default mode only inspects. Runtime code never performs DDL.
- The exact migration and its repeat application passed on an isolated local PostgreSQL 18 cluster. The integration workflow provisions the same schema on its disposable PostgreSQL database.
- The real Hono/DB integration tests passed: eight concurrent requests produce one header, two items and one creation audit event; failed item insertion rolls back header and receipt; retry, different-payload rejection, actor isolation, current client scope, deleted-record tombstones, legacy callers and RLS/grants are covered.
- Typecheck and production build passed. All 26 combined browser cases passed, including saved-record confirmation, opening canonical items, network-response loss, field validation, draft protection and a failed list refresh on mobile.
- All 189 local regression guards passed, including full-site certification. The final three retry/confirmation browser cases passed again after adding coverage that a later rejected retry must retain the key from an earlier uncertain commit.
- The form keeps a request key only for its current open attempt. Explicitly discarding an uncertain attempt does not undo a saved shipment; the close confirmation explains this. New forms intentionally represent new shipments, even when a PO reference matches another shipment.
- Existing API callers without a key remain compatible and gain atomic writes. They must supply a key to gain replay protection. Restricted staff must have access to the shipment's client, including on replay.

Reference: PostgreSQL [transaction-level advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) and Supabase [RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).

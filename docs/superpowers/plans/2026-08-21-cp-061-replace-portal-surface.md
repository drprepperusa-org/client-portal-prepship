# CP-061 Replace Portal Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full CP-061 portal surface — scoped replacement read model, backend-derived REPLACE badge, /replace list + drawer, forwarding create proxy, billing reference rendering — shipped schema-tolerant and live-dark.

**Architecture:** Portal backend derives all replacement truth in SQL from the shared DB's canonical `replacements`/`replacement_items` tables behind a cached schema-readiness gate (tables are NOT in prod yet). Frontend renders DTO fields verbatim. Create forwards to PREPSHIP_API_URL with the caller's bearer; upstream status passes verbatim.

**Tech Stack:** Hono + drizzle (postgres-js), React portal, tsx integration harness (throwaway Postgres creates the tables itself), static guards, Playwright.

## Global Constraints

- Prod DB has NO replacement tables (verified 2026-08-21): every read fails soft to empty via the readiness gate; no migration is applied anywhere but the throwaway test DB.
- Statuses (canonical PS-502 vocabulary): `requested | review | approved | label_created | label_failed | shipped | completed | rejected | cancelled`.
- Badge semantics per card: `cancelled` clears the badge (`status <> 'cancelled'`); other statuses keep it. `rejected` keeps the badge with its status visible — documented as pending PS-502 freeze, not guessed away.
- Redaction: `reason` is customer-safe; operator/admin fields (`reviewReason`, `adminOverride*`, `approvedBy`, idempotency/signature/fingerprint fields, `liabilityOwner`, `billable`) never cross the DTO.
- Capability minted: permission string `replacements:request`; capability name `canRequestReplacements`.
- Billing reference (`<orderNumber>-REPLACE[-n]`) renders verbatim from billing rows' `order_number` — no reformatting.
- `npm run typecheck`, `npm --prefix portal-client run typecheck`, `npm run test:guards` green after every task.

---

### Task 1: Schema mirror + readiness gate

**Files:** Create `src/db/schema/replacements.ts` (mirror: replacements — id, orderId, clientId, reference, status, reason, requestedAt, cancelledAt, createdAt; replacement_items — id, replacementId, orderId, sku, name, quantity, createdAt; column names byte-match prepship-v4), register in `src/db/schema/index.ts`. Create `src/lib/client-portal/replacements-schema-readiness.ts`:

```ts
let cache: { ready: boolean; at: number } | null = null;
export function resetReplacementsSchemaReadinessCache(): void { cache = null; }
export async function replacementsSchemaReady(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ready;
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from information_schema.tables
    where table_schema = 'public' and table_name in ('replacements', 'replacement_items')`);
  const ready = Number(rows[0]?.n ?? 0) === 2;
  cache = { ready, at: Date.now() };
  return ready;
}
```

- [ ] Implement, typecheck, commit.

### Task 2: Contracts + replacement read model

**Files:** Create `src/lib/client-portal/contracts/replacements.ts` (status union above; `PortalReplacementRow { id, reference, orderId, orderNumber, clientId, clientName, status, reason, itemCount, requestedAt }`; `PortalReplacementItem { id, sku, name, quantity }`; detail = row + items). Create `src/lib/client-portal/read-models/replacements.ts`: `listPortalReplacements(scope, {clientId, storeId})` (scoped via order join + `rawOrderScopeForAlias`, newest first, limit 200), `getPortalReplacement(scope, id)`, and `orderReplacementBadgeSql(alias)` — lateral emitting `has_active_replacement`, `replacement_status` (newest non-cancelled), `replacement_count`, `replacement_reference`; every read returns empty/nulls when `!(await replacementsSchemaReady())`.

- [ ] Implement, typecheck, commit.

### Task 3: Badge fields on the order read model

**Files:** Modify `src/lib/client-portal/read-models/orders.ts` (both list + detail: join badge lateral, readiness-gated — when not ready, constants false/null/0), `src/lib/client-portal/dto.ts` + `src/lib/client-portal/contracts/orders.ts` (add `hasActiveReplacement: boolean; replacementStatus: string | null; replacementCount: number; replacementReference: string | null`).

- [ ] Implement, typecheck, commit.

### Task 4: Routes + capability

**Files:** Modify `src/lib/client-portal/capabilities.ts` (+`canRequestReplacements: scope.isGlobal || scope.permissions.includes('replacements:request')`), `src/lib/client-portal/contracts/access.ts` (+field), wherever capabilities serialize to the client. Create `src/routes/client-portal/replacements.ts`: GET `/replacements` (scoped list + audit), GET `/replacements/:id` (scoped detail, 404 out-of-scope), POST `/replacements` — requires `canRequestReplacements` (403 for client users; audit `.denied`), then forwards body verbatim to `${PREPSHIP_API_URL}/api/replacements` with the caller's bearer, passes upstream status + body through verbatim, 503 with stable code when PREPSHIP_API_URL unset (mirror `billing-date.ts:23-83` pattern). Mount in the client-portal aggregator beside returns.

- [ ] Implement, typecheck, commit.

### Task 5: Integration suite

**Files:** Create `scripts/integration/client-portal-replacements-cp061.integration.ts` (harness per cp058/cp060: `setupTestEnv()` first). The suite CREATES `replacements` + `replacement_items` in the throwaway DB (plain CREATE TABLE matching the mirror), then: (1) scoped list shows client A only; (2) detail 404 cross-client; (3) badge true for `requested`, (4) cleared for `cancelled`, (5) kept-with-status for `rejected` (documented pending freeze); (6) `replacement_count`/newest-status correctness with two replacements; (7) reference passthrough `X-REPLACE`; (8) DROP TABLEs + reset cache → list empty, order badge false, no throw (fail-soft proof); (9) notes/internal columns absent from DTOs (serialize + key-scan). Register `test:client-portal-replacements-cp061:integration` + workflow step.

- [ ] Implement; local run must exit 2 (no TEST_DATABASE_URL); commit.

### Task 6: Frontend

**Files:** `portal-client/src/lib/api/domains/replacements.ts` (list/detail/create); `portal-client/src/App.tsx` — extend `PortalCapability` union, wrap `/replace` in `<RequireCapability capability="canViewReplacements">`? No — list is for all portal users (scoped); only CREATE is capability-gated. Keep route open, gate the action. Rewrite `portal-client/src/pages/Replace.tsx`: real list (reference, order number, client, status chip, item count, requested date), empty state retained, detail drawer, create button behind `canRequestReplacements`; create modal posts via api domain and surfaces upstream error codes honestly (403 → "not enabled yet" copy). REPLACE badge chip in `Orders.tsx` row + order detail drawer sourced ONLY from `hasActiveReplacement`.

- [ ] Implement, portal typecheck + build, commit.

### Task 7: Guards + e2e

**Files:** Create `scripts/client-portal-replacements-cp061-guard.mjs`: portal-client never derives the badge (`grep`: no `status !== 'cancelled'` / no replacement filtering in tsx; badge render references `hasActiveReplacement` only); route file contains no `db.insert`/`db.update` on replacements (forward-only); contracts exclude `reviewReason|adminOverride|idempotency|signature|liabilityOwner|billable`; capabilities define `canRequestReplacements`; readiness module exists + is imported by both read models; register + `test:guards` discovery. Extend Playwright `client-portal-ui.spec.js`: badge on order row, populated /replace list + drawer via mocked API, create hidden for client_user, billing view renders a mocked `1321-REPLACE` row verbatim.

- [ ] Implement, mutation-check the badge-derivation assertion, run suite, commit.

### Task 8: Verification sweep + PR

- [ ] Full typechecks, `npm run test:guards`, targeted Playwright, push branch, PR with PS-336 placement block; CI runs the new integration suite; report.

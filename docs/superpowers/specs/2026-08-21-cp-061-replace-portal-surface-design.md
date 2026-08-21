# CP-061 — Replace portal surface (design)

Date: 2026-08-21 · Ticket: CP-061 (https://trello.com/c/o72BKH1W) · Approved by Lawrence

## Context that shaped this design

- PS-502's replacement schema/routes exist on prepship-v4 stable but are dark:
  `REPLACEMENTS_ENABLED=false`, every route `requireInternalPermission` (portal
  sessions refused), DTOs are raw rows, and the badge contract
  (`hasActiveReplacement` et al.) exists nowhere — verified absent even in the
  unmerged `ps-502-completion` commits.
- The replacement tables are NOT in the shared production database (verified
  2026-08-21 via information_schema: zero `replacement%` tables). Migrations
  0096–0101 are operator-lane, DJ-authorized, not applied.
- Lawrence chose: build the full CP-061 surface now, including the missing
  read-side contract, portal-side. Everything ships schema-tolerant and
  live-dark — deploy ≠ activate, matching PS-502's own posture.
- The one frozen upstream contract: billing reference
  `<orderNumber>-REPLACE` (bare for #1) / `-REPLACE-<n>` (n ≥ 2), carried in
  billing rows' `order_number`.

## Decisions

- **Portal backend owns the read-side derivation** (shadow renderer over the
  shared DB, same as returns/billing): badge fields and the replacement list
  are computed in portal backend SQL from canonical `replacements` rows.
  `portal-client/` renders DTO fields verbatim — a guard rejects local
  derivation.
- **Schema-tolerant reads.** A cached runtime readiness gate (information_schema
  probe) guards every replacement read; while the tables are absent, reads
  fail soft: empty list, `hasActiveReplacement: false`, no 500s.
- **Operator notes are redacted; `reason` is customer-safe** (resolves the
  card's open question). No carrier/service/provider/cost identity in any DTO.
- **Create is a thin forwarding proxy** to `PREPSHIP_API_URL` POST
  /api/replacements with the caller's bearer; upstream status passes through
  verbatim (403 today — honest), never translated into success. No local write
  path exists.
- **Capability name minted here as `replacements:request`** and documented as
  the frozen name for PS-502 to adopt. Client users: no action, no route, 403
  on direct POST.
- **Cancelled clears the badge** by exclusion in the badge SQL
  (`status <> 'cancelled'`), so the next canonical read after cancellation
  drops it.

## Components

1. `src/db/schema/replacements.ts` — read-only drizzle mirror of the columns
   the read model needs (id, reference, order_id, client_id, status, reason,
   requested_at/created_at, item table: replacement_id, sku, name, quantity).
   Mirrors prepship-v4 `src/db/schema/replacements.ts` naming exactly.
2. `src/lib/client-portal/replacements-schema-readiness.ts` — cached probe
   (60s TTL) that both tables exist; exported for reads and for tests to reset.
3. `src/lib/client-portal/contracts/replacements.ts` — DTO + status union
   (passthrough of canonical statuses) + list/detail shapes.
4. `src/lib/client-portal/read-models/replacements.ts` — scoped list + detail
   + `orderReplacementBadgeSql(alias)` fragment used by the order read model.
5. Order read model + orders contract gain the four badge fields.
6. `src/routes/client-portal/replacements.ts` — GET / (scoped list), GET /:id
   (scoped detail), POST / (forwarding proxy, staff/capability only).
7. `portal-client`: api domain, Replace.tsx list + drawer, REPLACE badge chip
   on order rows and order detail, create modal (capability-gated),
   `RequireCapability` wrapper on the /replace route.
8. Billing: verify the billing renderer passes `order_number` through verbatim
   (`1321-REPLACE` renders untouched); pin with a guard assertion.

## Testing

- Integration suite (CI throwaway Postgres) CREATES the replacement tables
  from the mirrored schema, then proves: scoped list/detail; badge SQL true /
  false / cancelled-cleared; counts; reference passthrough; readiness gate
  fail-soft when tables are dropped; notes/internal fields never in DTOs;
  client scoping (client A cannot see client B).
- CP-061 static guard: badge fields only from backend DTO (no derivation in
  portal-client), notes redaction, forwarding proxy has no local INSERT,
  capability gate present, /replace wrapped in RequireCapability.
- Playwright (mocked API): badge on order row + detail, populated /replace
  list + drawer, create action visibility gated, client_user negative,
  billing reference rendering.

## Non-goals

- No prepship-v4 changes; no migrations applied anywhere outside the test DB;
  no lifecycle/label/inventory/billing writes; no attempt to flip
  REPLACEMENTS_ENABLED or widen PS-502's internal-only routes.

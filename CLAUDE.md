# Agent Instructions — PrepShip v4-stable

This file is read by AI coding agents (Claude Code, Cursor, Copilot,
Codex, etc.) before making changes to this repository.

> **Symlinks**: `CLAUDE.md` and `.cursorrules` mirror this file so all
> agent surfaces see the same rules. Edit AGENTS.md and run the sync
> step at the bottom if you change anything.

---

## Shipped & Cancelled order data — lockdown removed

> **History:** This repo previously carried a "🔒 LOCKDOWN" on
> shipped/cancelled order data that required the phrase
> `unlock shipped data` before an AI agent could touch those surfaces.
> The repository owner removed that lockdown on 2026-05-30. There is no
> longer any AI-protected/locked code in this repository.

Agents may now read and modify shipped/cancelled order code paths like
any other code, subject to normal good practice and the conventions
below. **However**, this is a real production fulfillment system, so the
ordinary production-safety expectations still apply (these are operational
guardrails, not AI locks):

- Do not run `UPDATE`/`DELETE` against real production shipped/cancelled
  orders, or rewrite shipment history, without the owner's explicit
  go-ahead for that specific action.
- Do not trigger real labels, postage purchases, or live marketplace
  notifications from development/testing without explicit approval.
- Prefer additive/migration-safe schema changes; flag any destructive
  migration before running it.

These are sanity rails for live operations — not a refactoring lock.

---

## Repository conventions

- **No backend pushes without permission** — when the user says
  "do not push" or "review first," the agent must commit locally only,
  never push.
- **TypeScript strict mode** — all new code must pass `npm run typecheck`.
- **Tailwind first** — prefer Tailwind utility classes over hand-written
  CSS.
- **Theme-aware tokens** — use the design tokens defined in
  `tailwind.config.ts`. Avoid hardcoded hex values in component styles.
- **Don't touch the `prepshiptemporary` repo** — that's a separate
  scratch repo (`X:/Private/temporaryprep/prepshiptemporary`); copying
  code FROM it requires user approval per file.

### Frontend

- The active client-portal frontend lives in `portal-client/` (Vite +
  React + Tailwind, glassmorphism UI). The repo's `dev:web` /
  `build:web` / `preview:web` scripts run it. The legacy `web/` app is
  retained on disk and reachable via the `*:web:legacy` scripts.

---

## Client Portal — shadow-renderer / source-of-truth law

The Client Portal is a **shadow renderer** of PrepShip / database truth. It
displays what PrepShip already knows; it does not become a second place where
business facts are decided. This law is the umbrella over CP-017→024 (and the
CP-026→031 returns work) and is enforced by static guards — see
`docs/source-of-truth-matrix.md` for the full surface-by-surface SOT matrix.

**The rule:**

- Client Portal must **derive every business value** — status, bucket, rate,
  total, count, metric, and any customer-visible field — from
  database / PrepShip-backed canonical sources.
- If PrepShip already shows or uses a value, Client Portal must pull from that
  **same canonical owner** (or a shared backend read-model extracted from it),
  never a parallel re-derivation.
- `portal-client/` may **arrange** backend data, **format** it, **sort/hide**
  visible rows, and make presentation or derived computations **only when every
  input is sourced from database/PrepShip AND the computation does not become an
  independent source of truth.**
- Computed fields must **document their source inputs, event clock, formula, and
  owner.** If a computed field is customer-visible or operationally
  authoritative, prefer **backend DTO / read-model ownership** so PrepShip and
  Client Portal share one definition and cannot drift.
- Client Portal must **NOT**: invent source data; rank/select rates from
  competing internal fields; create an alternate billing / inventory / status /
  redaction truth; silently fall back to a stale or nearby field; or duplicate a
  PrepShip calculation in a way that can drift.

**Backend DTO naming:** Client Portal APIs should expose **intent-named DTO
fields** that delegate to the canonical owner — e.g. `customerShippingRate`,
`effectiveStock`, `orderedUnits`, `ledgerShippedUnits`, `billedShippingTotal`,
`displayTrackingNumber`. Generic names (`shipping`, `sold`, `stock`, `total`)
are acceptable **only** when the DTO docs name the source + event clock +
formula, so two numbers on one page can never silently mean different things.

**Enforcement:** tests/guards must fail when `portal-client` introduces
unsourced business truth, an unapproved fallback chain, or a forbidden
customer-facing DTO exposure (carrier / service / provider / rate identity). The
enforcement layer includes `test:client-portal-sales-sot-drift`,
`test:client-portal-analytics-parity`, `guard:client-portal-architecture`, the
per-surface SOT guards, and `test:client-portal-shadow-renderer` (which pins
this law + the matrix in place).

---

## Sync step (run if AGENTS.md changes)

After editing this file, mirror to the other agent surfaces so all
tools see the same rules:

```bash
cp AGENTS.md CLAUDE.md
cp AGENTS.md .cursorrules
```

(Both `CLAUDE.md` and `.cursorrules` are intentionally file-identical to
AGENTS.md so a human can verify with `diff AGENTS.md CLAUDE.md`.)

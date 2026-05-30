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

## Sync step (run if AGENTS.md changes)

After editing this file, mirror to the other agent surfaces so all
tools see the same rules:

```bash
cp AGENTS.md CLAUDE.md
cp AGENTS.md .cursorrules
```

(Both `CLAUDE.md` and `.cursorrules` are intentionally file-identical to
AGENTS.md so a human can verify with `diff AGENTS.md CLAUDE.md`.)

# Receive shipment validation and draft recovery

## Placement contract

- Outcome: validate every received quantity, keep failed drafts, confirm before discarding edits, and refresh canonical receipt history after a successful receive.
- Bad input currently enters through `Number(value) || 0` in the drawer and quantity coercion in the route. Shared request validation will reject blanks, invalid numbers, negative/fractional/out-of-range quantities and invalid item identities.
- `receivePortalInbound` will own the existing atomic worksheet over inbound headers/items and delegate inventory writes to `applyInventoryMovementInTransaction`. The route will validate/authenticate and delegate. Client scope is checked against the locked header; terminal shipments cannot be received again.
- The frontend will use the existing draft-modal and field-error components. It submits intent and displays backend results, without deriving stock or status. Failed refreshes must not turn successful writes into apparent failures.
- Preserve explicit zero quantities and quantities above expected; this task introduces no short/over-receipt business policy. Inventory additions require a client and an unambiguous SKU match; missing SKUs remain reported as unmatched.
- Verify API validation, scope, atomic rollback and repeated/concurrent requests in disposable PostgreSQL; verify validation, close/navigation protection, failed saves, successful refresh and mobile layout in browser fixtures.
- No migration. Deployment to main is authorized. No real receiving, inventory mutation or provider action will be performed in production testing.

## Local verification

- PostgreSQL integration passed: invalid quantity/identity rejection, exact item membership, client and role boundaries, concurrent receives, terminal-state protection, canonical receipt reads and full rollback after an inventory match conflict.
- Five receiving browser flows passed, covering field errors, explicit zero, receipt refresh, failed save retention, pending-save protection, clean/dirty closing, Escape/Back/refresh, discard reset and mobile layout.
- Existing 26 create/validation/unsaved-form browser cases and three inbound-search cases passed.
- Typecheck, production build, source-line and maintainability checks passed. Full repository suite: 189/189 passed.
- Visual inspection confirmed the mobile worksheet and discard dialog fit. Test writes used only disposable PostgreSQL and intercepted browser requests.

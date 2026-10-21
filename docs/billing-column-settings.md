# Client-visible billing columns

Settings → Billing → Client-visible billing columns is a shared presentation
setting for all client accounts, not the admin's personal table layout.

The canonical owner is `src/lib/client-portal/billing-columns.ts`, stored under
`settings['portal.billing.client_visible_columns.v1']`. The contract lives in
`src/lib/client-portal/contracts/billing-columns.ts`. The existing settings table
requires no migration. An absent setting retains all current columns; an invalid
setting fails closed rather than showing columns the admin hid.

`GET /api/client-portal/billing/columns` requires authenticated, scoped financial
access. `PUT` additionally requires the canonical global-admin capability, because
the change applies to every client. The service repeats that check, validates
allowlisted keys and required identity columns, serializes writes under a
transaction lock, and checks the expected revision. The setting and before/after
audit event are committed together; stale edits return 409.

The Billing summary and line-item tables render the saved selection over their
existing canonical DTO columns, on desktop and mobile. Admin-only Settings shows
saved Visible/Hidden states and a separate unsaved draft. Clients refetch the
setting on entry/focus and every 30 seconds. Read errors block the table instead
of temporarily showing every column. Existing personal admin layouts cannot
restore a column excluded by the shared selection.

This is presentation visibility, not field-level data redaction. Billing DTO
amounts, money calculations, invoice exports and permissions are unchanged.
It does not rewrite orders, returns, fees, or historical invoice lines.

Verification: `npm run test:billing-column-settings`,
`npx playwright test web/e2e/billing-column-settings.spec.js --workers=1`,
typecheck/build, architecture, shadow-renderer, contract-drift and access guards.

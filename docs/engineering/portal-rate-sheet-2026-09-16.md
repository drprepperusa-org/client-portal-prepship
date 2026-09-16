# Client Portal Rate Sheet

## Placement and outcome

Replace the placeholder with the current saved prep, monthly storage and custom
package configuration for accessible clients. `billing_config` and
`client_package_prices` are the canonical configuration owners used by PrepShip
Billing. `listPortalRateSheets` reads those exact fields; the route validates and
audits, and React formats the shared DTO. Missing configuration must remain null,
never a fabricated zero or schema default. Financial permission is mandatory.

Package prices are explicitly labeled **before billing adjustments**. PrepShip's
`decidePackageCostLine` applies package markup and shipment/operator-specific rules
to invoice charges. This sheet shows the saved configuration, not an invoice quote;
it neither copies that formula nor exposes internal markup or warehouse `unit_cost`.
Prep and storage also show current configuration; frozen invoices remain authoritative
for historic and shipment-specific charges. No shipping rates are synthesized.

Client filtering intersects authenticated client scope using the existing client
predicate. Store-only scope without assigned clients remains fail closed, consistent
with the client picker. Active non-system clients match Billing's configuration
surface. Inactive billing configurations remain visible with explicit inactive copy.
Only custom packages with saved client prices appear; unlisted boxes have no published
price on this sheet. Provider-owned package rows and internal fields are omitted.

## Contract

- `services.pickPackFee`, `includedUnits`, `additionalUnitFee`, and
  `storageFeePerCuFt`: verbatim configuration columns. Storage keeps four decimal
  places. `services.updatedAt` is `billing_config.updated_at`.
- `configurationStatus`: presence of configuration plus its active flag.
- `packages.configuredPrice`: verbatim `client_package_prices.price`;
  package name/dimensions from custom catalog rows. No warehouse cost fallback.
  `packages.updatedAt` is the saved client's package-price update time.
- Request cache keys include user and selected client. No date filtering: current
  configuration is not a historical effective-date schedule. The endpoint sends
  private/no-store; page re-entry and Refresh rates fetch fresh values.

## Verification and release

PostgreSQL fixtures prove exact values, zero vs missing vs inactive, four-decimal
precision, provider/internal-field redaction, financial permissions, client isolation,
invalid client IDs and explicit 503 on database failure. Browser fixtures cover
desktop/mobile, selected client, denied permission, retry, refresh, empty state and
late responses. Both are registered in hosted CI; update the old placeholder guard
to require live backend/error/missing-rate behavior instead.

No schema, dependency, pricing-policy or business mutation changes. Tests use a guarded
disposable database and block external fetch. Deployment follows standing direct-main
authorization. Release base/rollback: `47506cd8fb5f7fbbb39d0489fef76ec8cedee13d`.

Local release evidence: the full 186-check suite passed 185 checks; its sole failure required using the shared DataTable instead of native table markup. After that correction, the table permission guard, all three Rate Sheet browser scenarios, typecheck, production build, bundle budget/redaction and maintainability checks pass. Database fixtures also pass. Final desktop/mobile screenshots were inspected. Hosted CI runs the complete suite again on the committed candidate.

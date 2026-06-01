# CP-001 - Client Portal Orders: show SKU line qty and replace account/best-rate columns with Selected Rate

## Task Metadata

| Field | Value |
|---|---|
| Task ID | CP-001 |
| Assignee | Lawrence / client portal dev |
| Repo | `drprepperusa-org/client-portal-prepship` |
| Branch | Create a feature branch from `main`; do not push directly to `main` |
| Primary frontend | `portal-client/` |

## Context

DJ reviewed the Client Portal Orders table screenshots.

In the Orders table, the Item Name column already shows an `xN` badge when a line item quantity is more than `1`, but the SKU column currently only renders the SKU text. DJ wants SKU rows to also show the line-item quantity when quantity is greater than `1` so the SKU side lines up with the item-name quantity info.

In the Shipped Orders view, the table currently shows Shipping Account and Best Rate. DJ said:

> do not show shipping account or best rate, it should show selected rate though.

This is the active glassmorphism portal frontend. Per repo instructions, the active client-portal frontend is `portal-client/`; legacy `web/` exists but is not the primary app.

## Files To Inspect First

- `portal-client/src/pages/Orders.tsx`
  - Current columns include SKU, Qty, Shipping Account, Carrier, and Best Rate.
  - SKU renderer currently maps `o.items.slice(0, 4)` and prints only `it.sku`.
  - Item Name renderer already has the desired `Number(it.quantity) > 1 && x{it.quantity}` pattern.
- `portal-client/src/lib/api.ts`
  - `PortalOrder` fields include `carrierCode`, `serviceCode`, `shippingAccount`, `shippingService`, `shippingAmount`, `bestRateJson`, and item quantities.
- `src/lib/client-portal/dto.ts`
  - Backend DTO currently resolves `shippingAccount` from override/shipment/rate account.
  - Do not expose account nicknames in the Orders table.
  - Existing comments describe selected/best-rate carrier/service source-of-truth. Verify whether the frontend already receives enough selected-rate data or if the DTO needs a narrowly scoped additive field.

## Implementation Requirements

### A. SKU Column Line Quantities

- Update the Orders table SKU column so each SKU line shows a small `xN` badge when that specific item quantity is greater than `1`.
- Match or harmonize with the Item Name column badge style, while keeping SKU text readable and compact.
- Keep the `+N more` behavior consistent when there are more than 4 items.
- If the Item Name column shows `+N more`, the SKU column should not look mismatched or misleading.
- Do not change total order quantity logic; the Qty column should continue showing total shippable item count.

### B. Replace Shipping Account / Best Rate With Selected Rate

- Remove or hide the Shipping Account column from the Orders table.
- The portal must not show account nicknames or identifiers such as `G19Y32` or `ROCEL C81F70` in this table.
- Remove or hide the Best Rate column from the Orders table.
- DJ does not want Best Rate shown here, especially not `- pending` on shipped rows.
- Add or show a Selected Rate column instead.
- Selected Rate should describe what rate/service was selected for the order without exposing the shipping account nickname.
- Prefer selected/actual shipment data for shipped/cancelled orders: carrier, friendly service, and selected/charged shipping amount if available.
- For awaiting orders, use the currently selected rate data if the backend exposes it.
- If only best-rate data exists, label it as selected only if it is actually the selected rate/source-of-truth, not just an arbitrary quote.
- If amount is unavailable, show carrier/service cleanly rather than `- pending` when carrier/service exists.
- If no selected rate exists, show a neutral `-` or `Not selected`, not `- pending` best rate.
- Keep the existing Carrier column only if it still adds value and does not duplicate the Selected Rate column.
- If Selected Rate clearly includes carrier, it is acceptable to simplify or remove duplicate carrier UI after checking the layout.
- Preserve client/store scope and DTO redaction.
- Do not expose raw provider payloads, secrets, account IDs, postage labels, or cross-client data.

## Testing Applicability

This is an operator/client-facing Orders workflow bug, so it needs UI verification, not just typecheck.

Required checks:

- Type/build:
  - `npm --prefix portal-client run typecheck`
  - `npm run build:web`
- Add or update a focused frontend guard/test for the Orders columns if an existing suitable test exists.
- Otherwise add the smallest maintainable check that verifies:
  - SKU line with quantity `2+` renders `xN` next to that SKU.
  - Orders table headers do not include Shipping Account or Best Rate.
  - Orders table includes Selected Rate.
  - Shipping account nicknames are not rendered in the Orders table fixture.

Browser/manual verification on the active portal UI:

- Awaiting shipment tab: multi-quantity SKU line shows `xN` in SKU column.
- Shipped tab: no Shipping Account, no Best Rate; selected carrier/service/rate displays under Selected Rate.
- Cancelled tab: same column policy, with graceful blank/neutral display when selected rate is unavailable.

## Guardrails

- Do not push directly to `main`.
- Do not trigger real labels, postage purchases, live marketplace notifications, or production shipped/cancelled mutations.
- Do not run production SQL `UPDATE` or `DELETE`.
- Do not weaken auth, RBAC, client/store scope, DTO redaction, or credential/account protections.
- Do not modify legacy `web/` unless you prove it is still used for this deployed screen; default to `portal-client/`.

## Definition Of Done

- SKU column displays line-item quantity badges for quantities greater than `1`.
- Orders table no longer displays Shipping Account or Best Rate columns.
- Orders table displays a Selected Rate column sourced from selected/actual rate data.
- Selected Rate never exposes account nicknames.
- Typecheck/build pass.
- Focused UI, guard, or browser verification evidence is included in the return summary.

## Return Format

Reply with:

- Branch name
- Files changed
- Short summary of behavior changed
- Verification commands run plus pass/fail
- Screenshots or clear browser evidence for Awaiting shipment and Shipped views
- Confirmation that no live labels, postage, marketplace notifications, or production shipped data mutations were performed

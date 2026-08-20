# CP-060 — Per-shipment shipping classification in the SKU drawer (design)

Date: 2026-08-21 · Ticket: CP-060 (https://trello.com/c/QypfIjNP) · Approved by Lawrence

## Problem

The SKU drawer read model (`src/services/sku-orders.ts`) sums customer-billed shipping
at order grain and classifies the ENTIRE amount by the newest non-voided label's
service (`order by s.id desc limit 1`). Mixed standard/expedited multi-label orders
disagree with PrepShip's canonical per-shipment reporting (PS-418). Independently, the
drawer DTO ships standard-only money under the generic names `shippingCharge` /
`avgShippingCharge`, so an expedited order renders no shipping at all and every
expedited dollar silently drops from the average.

## Scope decisions (user-approved)

- **Drawer-only.** The Analysis table keeps zero shipping fields; the CP-035
  ship-bucket guard stays untouched. AC-4 is satisfied at the drawer surface.
- **Total + std/exp split.** Each drawer order row shows total billed shipping plus
  standard/expedited subtotals when mixed; the summary shows separate std and exp
  averages, matching PrepShip's per-class reporting.

## Data facts (verified in production, 2026-08-21)

- `billing_line_items.shipment_id` exists with index; 24,469 of 24,604 shipping lines
  (99.45%) carry it. 135 legacy nulls, newest 2026-08-13. Per-shipment billed money is
  the primary path; legacy rows get an explicit state, never a guessed class.

## Design

**Read model** (`src/services/sku-orders.ts`): replace the newest-label lateral with an
aggregate over ALL non-voided labels. Each label is classified by its service code
against the shared expedited list; each label's billed money joins via
`billing_line_items.shipment_id`. Per order row emit:

- `shippingTotal`, `shippingStandard`, `shippingExpedited` (numeric, dollars)
- `shippingMoneyState`: `attributed` | `partial_unattributed` | `unattributed_legacy`
  | `unbilled` | `external_label` | `voided_only`

Summary emits `avgShippingStandard` / `avgShippingExpedited`, computed only over
orders whose state permits attribution. Nothing fabricates a class for money that
cannot be attributed.

**Classification single source** (`src/lib/shipping-class.ts`): the
`EXPEDITED_SERVICES` list currently hand-copied in `routes/analysis.ts` moves here;
the analysis route and sku-orders both import it. The list mirrors prepship-v4's
`REPORTING_EXPEDITED_SERVICES` (PS-418); a static guard pins the list contents and the
single-source imports so cross-repo drift is at least loud locally.

**DTO/route** (`src/routes/client-portal/analysis.ts` + contracts): drawer DTO gains
the three money fields plus state; the misleading `shippingCharge` →
`standard_shipping_cost` and `avgShippingCharge` → `avgStandardShippingCost` mappings
are deleted. No carrier/service/provider identity is added — class labels only
(`standard` / `expedited`). The DTO redaction guard is extended for the new fields.

**Frontend** (`portal-client/src/pages/Analysis.tsx` drawer): thin renderer. Shows
total; shows a "std $X · exp $Y" split line only when both classes are nonzero; shows
explicit muted state labels (unbilled / external label / legacy) instead of blank
cells. No math in React.

## Rejected approaches

- Two queries + TypeScript merge (logic drifts from the SQL truth PrepShip uses).
- Calling PrepShip's API for the projection (cross-service runtime coupling for a read
  model).
- Table + drawer scope (reverses the deliberate CP-035 removal; guard pins it).

## Tests

Focused DB-backed fixtures: mixed-class multi-label split; single-label standard and
expedited totals unchanged; voided-newest-label no longer promotes the next label into
classifying the whole order; external; unbilled; legacy null `shipment_id`; tenant
scope. Static guard: shared-list contents, single-source imports, DTO field presence,
no `order by s.id desc limit 1` classifier left in sku-orders.

## Canonical ownership (PS-336 placement)

Business rule: per-label classification of customer-billed shipping money. Owner: the
CP backend read model (`sku-orders.ts`) consuming the shared classification module —
the same definitions PrepShip's PS-418 projection owns upstream. Frontend renders DTO
verbatim. Bad-data ingress: legacy billing lines without `shipment_id` — handled as an
explicit state at the read-model boundary, not patched in the UI.

# Shopify Direct Client Store Connect — Design

Date: 2026-07-08
Status: Approved design, pending implementation plan
Scope: Client portal + backend (PrepShip v4-stable)

## Overview

Portal clients connect **their own Shopify store directly to PrepShip** from the
portal's Connections page. PrepShip validates the credentials live, the operator
approves the connection in the admin app, and from approval forward PrepShip's
own Shopify connector pulls the store's new orders into the normal `orders`
pipeline, attributed to that client. The client then sees their orders in the
portal with **their PrepShip rate card** rates via the existing CP-040
frozen-billing → projection resolver.

**This is a direct Shopify → PrepShip integration.** PrepShip's connector calls
the Shopify Admin API itself. No ShipStation bridge, no third-party aggregator
anywhere in this path.

Shopify is the first platform; the portal's 13-platform catalog UI already
exists and other platforms follow later with their own connectors.

## Decisions (from brainstorm, 2026-07-08)

| Decision | Choice |
| --- | --- |
| Goal | Client self-serve connect; PrepShip pulls their orders; orders visible in portal |
| "Their shipping rates" | The client's PrepShip rate card via the existing CP-040 resolver — NOT buyer-paid Shopify shipping |
| Connection method | Client provides credentials: shop domain + Admin API access token (custom app, `read_orders` scope only) |
| Activation | Live credential validation at submit + operator approval gate before any sync (M7 model kept) |
| Backfill | None — orders sync from approval forward only (also avoids Shopify's `read_all_orders` grant: stores only expose the last 60 days of orders by default) |
| Transport | Direct polling of the Shopify **GraphQL Admin API** via existing scheduler (Approach A); webhooks deferred to v2. REST Admin API is legacy — new integrations use GraphQL (verified against shopify.dev 2026-04 docs) |

## Architecture & data flow

```
CLIENT (portal)                     OPERATOR (admin app)          PREPSHIP (backend)
Connections page
 → Connect store → Shopify
 → shop domain + token
 → live validation ────────────────────────────────────────────→ GraphQL: shop { name myshopifyDomain }
 → "✓ <shop>.myshopify.com          Review & approve              (token never echoed)
    — pending approval"             (promote portal→admin,
    store_accounts row:              active=true,
    source='portal',                 sync_anchor_at=now())
    active=false
                                                                  Scheduler (existing cadence)
                                                                  → shopify-order-sync service
                                                                  → poll active Shopify accounts,
                                                                    orders created ≥ sync_anchor_at
                                                                  → connector normalizes
                                                                  → upsertNormalizedStoreOrders()
                                                                  → orders + order_items
                                                                    (clientId = store's client,
                                                                     storeId = 9,200,000 + acct id)
Portal orders pages ◄──────────────────────────────────────────── DB (shadow renderer)
Customer Shipping Rate = client's rate card (CP-040 resolver, unchanged)
```

- No new tables. Credentials stay in the existing RLS-protected
  `store_accounts` (jsonb).
- One additive migration adds sync bookkeeping to `store_accounts`:
  `sync_anchor_at` (forward-only floor, stamped at approval),
  `sync_cursor_at` (incremental `updated_at` progress),
  `last_synced_at`, `last_sync_error`.
- Orders enter through the PS-031 rails that already exist:
  `upsertNormalizedStoreOrders()` with `sourceProvider='shopify'`,
  `sourceAccountId=<store account id>`, `sourceOrderId=<Shopify order id>`.
  Idempotent upsert on `externalOrderId` (`shopify-{orderId}`), shipped/
  cancelled status protection, and `order_items` fan-out are already handled.
- Store identity uses the existing synthetic store id convention
  (`syntheticStoreIdForCredentialAccount`: Shopify offset 9,200,000).
- Shadow-renderer law holds: the portal only displays DB truth. Buyer-paid
  `shipping_amount` from Shopify is stored on the order but is NEVER used as
  the Customer Shipping Rate (CP-040 unchanged).

## Surface visibility — who sees what (confirmed 2026-07-08)

One shared `orders` table means a successfully synced Shopify order appears in
BOTH apps automatically — no cross-app sync exists or is needed. But the two
surfaces show different depths:

| Surface | Sees |
| --- | --- |
| **Client portal** | Their own orders (client scope), order status/details, and the **Customer Shipping Rate** — their PrepShip rate card price via the CP-040 frozen→projection resolver. **Never** carrier names, service names, live/browse rates, best-rate comparisons, or provider identity — the portal's existing carrier/service/provider/rate-identity redaction guards apply to Shopify-sourced orders identically. |
| **PrepShip v4 (admin)** | The same orders, plus full operations: browse live carrier rates (`src/routes/rates.ts` / `src/services/rates.ts` — reads order weight/ship-to, quotes YOUR carrier accounts, applies markups/filters), best-rate selection (`order_overrides.bestRateJson`), label purchase, frozen `shipments.selectedRateJson` snapshot. |

Rate browsing is order-source-agnostic: it needs order fields (ship-to,
weight), not a ShipStation origin, so it works on Shopify-sourced orders from
day one. If a Shopify order arrives without usable weight, the operator fills
it in the admin app before rating — same as any other order.

## Component changes

Backend:

1. **Migration** `drizzle/0037_store_account_sync_state.sql` (or next
   sequential number when implementation lands) — additive only: the four
   sync columns above.
2. **`src/connectors/store/shopify.ts`** — becomes real. Gains
   `fetchOrdersSince(credentials, floor, cursor)` — POST
   `https://{shop}.myshopify.com/admin/api/<pinned version>/graphql.json`
   running the `orders` query filtered by `updated_at:>=<cursor>`, cursor
   pagination via `pageInfo.endCursor`, throttle handling via the response's
   `extensions.cost.throttleStatus` (wait for point restore, resume) — and
   `normalizeOrder(shopifyOrder) → NormalizedStoreOrder`. Status mapping:
   `cancelled_at` set → `cancelled`; `fulfillment_status='fulfilled'` →
   `shipped` + `externallyShipped=true`; otherwise `awaiting_shipment`.
   Line items map to the same `items[]` shape the ShipStation path writes.
   Connector owns normalization (PS-031).
3. **New `src/services/shopify-order-sync.ts`** — orchestration only: load
   active Shopify accounts, per-store try/catch, enforce the forward-only
   floor (`created_at >= sync_anchor_at`), advance `sync_cursor_at` only after
   a page is fully persisted, record `last_sync_error`.
4. **`src/services/sync-scheduler.ts`** — invoke the new sync alongside the
   existing ShipStation `syncOrders({})` on the same cadence.
5. **`src/routes/client-portal/integrations.ts`** —
   - `POST /integrations`: drop the admin-only gate; any authenticated portal
     user may submit, but `clientId` is FORCED from their scope (never from
     the body). Everything else stays: `source='portal'`, `active=false`,
     credentials never echoed, 409 on duplicate.
   - New `POST /integrations/validate`: server-side GraphQL test call
     (`{ shop { name myshopifyDomain } }`), ~5s timeout, rate-limited
     (5/min per user), returns only `{ ok, shopName, myshopifyDomain }` or a
     generic failure. Pre-submit UX feedback ONLY — nothing from this
     response is trusted at submit time.
   - Submit re-validates server-side: `POST /integrations` for Shopify runs
     the same shop query itself and derives `account_identifier` from
     Shopify's `myshopifyDomain` answer — never from the browser. (A
     spoofed submit body can't claim someone else's canonical domain, and a
     store that fails validation is rejected at submit with the same generic
     message.)
6. **Approval stamping** — the existing promote flow (`portal` → `admin`,
   `active=true`) additionally sets `sync_anchor_at = now()`.
7. **Env flag** — `SHOPIFY_SYNC_ENABLED` boolean in `src/lib/env.ts`
   (default off), so deploy ≠ activate.

Portal UI:

8. **`portal-client/src/components/store/StoreConnectModal.tsx`** — Shopify
   path gains a short "how to get your token" guide (Shopify admin → Settings
   → Apps → Develop apps → create app with `read_orders` scope only → copy
   Admin API token), a "Validating…" state, and success
   ("✓ Connected to <shop>.myshopify.com — pending PrepShip approval") /
   failure ("Check your shop domain and token") states.
9. **`portal-client/src/pages/Connections.tsx`** — connected-store cards show
   status: Pending approval / Active — syncing / Reconnect needed (from
   `last_sync_error`).

Admin app (`web/`): no required v1 changes — promote flow exists; sync-status
visibility there is a later nicety.

## Error handling

Connect time (instant, client-facing):

- Bad domain / bad token / timeout → one generic message: "Couldn't connect —
  check your shop domain and Admin API token." No oracle behavior (never
  reveal shop-exists vs token-wrong). Details to server logs only.
- Duplicate store → existing 409 message.
- Validation endpoint rate-limited per user.

Sync time (ongoing):

- Auth failure (401/403): after 3 consecutive failures set
  `last_sync_error='auth'`, pause that store's sync, portal card shows
  "Reconnect needed"; re-entering a token re-validates and clears. Account is
  never auto-deleted or deactivated — history stays.
- Throttling: honor GraphQL `throttleStatus` (wait for point restore);
  resume next tick if the budget stays exhausted.
- Malformed order: log and skip that order; never abort the batch (per-store
  AND per-order isolation).
- Idempotency: any window can be re-run safely (upsert + terminal-status
  protection in `upsertNormalizedStoreOrders`).

## Security

- `clientId` always derived from the authenticated portal scope; RLS on
  `store_accounts` backs it at the DB layer.
- Portal submissions can never claim `source='admin'` or `active=true`
  (already enforced; stays).
- **Security spine:** sync workers only read stores where
  `source='admin' AND active=true` — nothing a client submits reaches a
  worker until the operator promotes it. Pinned by a new static guard.
- Tokens: used for the one validation call, stored via existing rails, never
  in any response, audit row, or log line (audit records field names only).
- Client instructions require `read_orders` scope only — least privilege;
  no write access requested in v1.

## Testing & guards

Unit (new):

- Shopify normalization fixtures → `NormalizedStoreOrder` (statuses, items,
  buyer-paid shipping into `shippingAmount` only).
- Cursor/floor logic: anchor respected; cursor never advances past an
  unpersisted page.
- Validate endpoint: no credential echo; rate limit; canonical domain.

Integration (existing `scripts/integration` harness, `TEST_DATABASE_URL`):

- Full path: non-admin portal submit → `source='portal', active=false`,
  forced `clientId` → promote → sync against stubbed Shopify → orders/
  order_items attributed correctly → portal orders read-model returns them →
  Customer Shipping Rate resolves from that client's rate card.
- Cross-client injection attempt (body clientId ≠ scope) → forced to scope.

New static guards:

- `guard:shopify-sync-source` — sync reads only `source='admin' AND
  active=true` stores.
- Extend portal-integrations credential-safety guard to the validate
  endpoint.
- SOT guard: nothing in `portal-client/` derives a rate from
  `shipping_amount` (protects CP-040).

Must stay green: `npm run typecheck`, `npm run test:guards`,
`test:connector-registry`, `test:connector-architecture`,
`guard:client-portal-architecture`, `test:client-portal-sales-sot-drift`.

## Out of scope (v1)

- Shopify webhooks (v2 latency upgrade; polling remains the reconciliation
  baseline even then).
- Tracking write-back to Shopify (`shipment.confirm` stays stub; fulfillment
  outbox keeps marking Shopify confirmations `not_supported`).
- Inventory / product sync.
- Live connectors for the other catalog platforms.
- Carrier-calculated rates at the client's Shopify checkout.

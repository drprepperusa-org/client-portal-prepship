# CP-069 (proposed) — "Connect with Shopify": OAuth install on top of the store-connect pipeline

Date: 2026-09-03
Status: **PROPOSED COMPACT CONTRACT — awaiting DJ decisions D1–D7 and Hermes freeze. No code yet.**
Trello: #1169 (https://trello.com/c/0sDLHOZe) — "copy ShipStation's OAuth sign-in so clients sign in
with Shopify so we can see their orders. New client joining soon."
Repos: prepship-v4 (token owner, callback, refresh, sync) + client-portal-prepship (portal surface).
Supersedes nothing; extends the approved 2026-07-08 design (credential-based connect stays as a path).

## 1. What exists today (surveyed 2026-09-03, both repos)

- A complete **credential-based** Shopify client-store connect pipeline over ONE shared
  `store_accounts` table: portal `POST /api/client-portal/integrations/validate` and
  `POST /api/client-portal/integrations` accept either a pasted Admin API token (`accessToken`)
  or a per-client Dev Dashboard app's `clientId`+`clientSecret` (client-credentials grant),
  verify live (GraphQL `shop` + scope check), insert `source='portal', active=false`, and an
  operator approves (`POST /integrations/:id/approve` or admin `PATCH /store-accounts`) which
  sets `source='admin', active=true, sync_anchor_at`. Sync workers read only
  `source='admin' AND active=true`.
- The **only** authorization-code OAuth in either repo is eBay (PrepShip `/oauth/ebay/callback`,
  unauthenticated, mounted before the JWT block). The house "Connect with <provider>" pattern is
  the local-only `#1243` UPS branch: authenticated `GET /carriers/<p>/connect` → connector builds
  the authorize URL → unauthenticated callback under `src/lib/imported-handlers/` → connector
  exchanges the code → JSONB merge into `credentials`. Its state is deterministic (`carrier-<id>`),
  unstored and non-expiring — **not** acceptable for Shopify (below).
- Credentials are **plaintext jsonb** in the shared prod DB; no encryption primitive exists in
  either repo.
- Two pollers: PrepShip `SHOPIFY_SYNC_ENABLED` defaults **true**, the portal's defaults **false**.
  PrepShip deactivates a store after three auth failures; the portal's reconnect clears the
  error but never re-activates (cross-app gap, see §7).
- Today's portal copy tells EACH client to create their own Dev Dashboard app and paste its
  Client ID/secret. The card asks for the opposite: one click, sign in with Shopify.

## 2. What Shopify requires (official docs, fetched 2026-09-03)

- Authorization code grant for non-embedded apps:
  `https://{shop}/admin/oauth/authorize?client_id&scope&redirect_uri&state` → callback
  `?code&hmac&shop&state&timestamp` → `POST https://{shop}/admin/oauth/access_token`
  with `client_id, client_secret, code` (+ `expiring=1` for an expiring offline token).
- `redirect_uri` must **exactly** match a URL registered on the app; `state` must be a
  random nonce the app stored and checks (CSRF); the callback `hmac` is HMAC-SHA256 **hex** over
  the sorted `k=v&…` query minus `hmac`, keyed by the app's client secret, compared with
  `timingSafeEqual`; `shop` must match `^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$`.
- Tokens: expiring offline access token (1 h) + refresh token (90 d, **rotated on every
  refresh**); required for new public apps since 2026-04-01 and for **all** public apps from
  2027-01-01. Non-expiring tokens are legacy.
- Distribution decides everything: a **custom** app installs on one store or one Plus org; serving
  separate merchants needs a **public** app (may be unlisted / limited visibility) → App Store
  review, **Protected Customer Data Level 2** approval (order names/addresses/emails are redacted
  until approved — a fulfillment app is useless without it), the three compliance webhooks
  (`customers/data_request`, `customers/redact`, `shop/redact`), `app/uninstalled`.
- `read_orders` returns only the last 60 days; `read_all_orders` needs separate approval.
- Webhooks are signed with the app's client secret (base64 HMAC); on secret rotation Shopify
  signs with the oldest unrevoked secret for up to an hour.

## 3. Placement (PS-336 gate)

| Question | Answer |
|---|---|
| Canonical owner of Shopify OAuth truth | **prepship-v4**: `src/connectors/store/shopify-oauth.ts` (NEW: endpoints, authorize URL, callback HMAC, code exchange, refresh) + `src/services/shopify-oauth-install.ts` (NEW: state mint/consume, persistence through `credential-accounts.ts`) + `src/lib/imported-handlers/shopify-oauth-callback.ts` (NEW, mounted at `/oauth/shopify/callback`). |
| Where imperfect data enters | The unauthenticated callback (attacker-controlled query), the token exchange/refresh responses, and `store_accounts.credentials` written by three existing writers. |
| Callers that delegate | PrepShip operator `GET /store-accounts/shopify/connect`; portal `POST /api/client-portal/integrations/shopify/install` (thin proxy to PrepShip, clientId from scope never body); the two "Connect with Shopify" buttons (display/intent only); `shopifyCredentials()` (PS) and `resolveShopifyAccessToken()` (portal) gain an `authMode:'oauth'` branch that delegates refresh to the owner. |
| Duplicate authority to remove / forbid | No second state store; no token exchange in the portal; the eBay "most-recent active row" fallback is **not** reused; the callback never touches `source/active/sync_anchor_at` (approval owners stay `mutations.ts` / `credential-accounts.ts`). |
| Frontend role | Shop-domain input + button → `window.location.assign(url)`; renders backend `connectionStatus`. No scopes, tokens or state in React. |
| Boundary tests | §6. |

## 4. Design

**Install (portal client).** Connections → Shopify → enter `shop.myshopify.com` → "Connect with
Shopify" → portal `POST /integrations/shopify/install {shopDomain,label}` (scope + rate limit +
clientId from scope) → proxied to PrepShip, which normalises the domain, mints a state row
(`shopify_oauth_states`: random 16-byte hex, provider, shop_domain, client_id, initiated_by,
expires_at ≈ 10 min, consumed_at), returns `{url}` from the connector → browser goes to Shopify.

**Callback (PrepShip, unauthenticated).** Verify `hmac` (env client secret; accept old+new
during rotation) → look up state (`FOR UPDATE`, unconsumed, unexpired) else 403 → `shop` matches
the regex AND equals the state's shop → exchange code with `expiring=1` → verify via GraphQL
`shop` + scope check (canonical `myshopifyDomain`) → upsert `store_accounts` through
`credential-accounts.ts` keyed on the existing unique index, MERGING the token pair on conflict
(re-install must overwrite), `credentials = {shopDomain, accessToken, accessTokenExpiresAt,
refreshToken, refreshTokenExpiresAt, grantedScopes, authMode:'oauth'}` — **only** these keys
(no clientId/clientSecret, or the existing resolvers prefer client-credentials and break) →
`source='portal', active=false` (approval gate unchanged) → audit with field names only → HTML
"Connected, pending approval" page with a CTA from env (no token, no client-id prefix, no lengths).

**Refresh (PrepShip owns it).** Before use, if `accessTokenExpiresAt − 60s` has passed:
`grant_type=refresh_token` → persist the NEW access+refresh pair atomically, serialised per shop
(row `FOR UPDATE`) because two services share the table; 401 → mark `last_sync_error='auth'`
(portal shows Reconnect); 429/5xx → retry. The portal's own poller stays off (`SHOPIFY_SYNC_ENABLED`
false); if it ever runs, it delegates to the same owner or reads a fresh token only.

**Webhooks.** Bind by `X-Shopify-Shop-Domain` → `account_identifier`; `app/uninstalled` clears the
pair + `active=false` + audit; the three compliance topics answer 200 on valid HMAC, 401 otherwise.

**Env (Render, PrepShip):** `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_OAUTH_REDIRECT_URI`
(or derived from `PUBLIC_API_URL` as `<base>/oauth/shopify/callback`), `SHOPIFY_OAUTH_SCOPES`
(default: the portal's `REQUIRED_SHOPIFY_ACCESS_SCOPES`), `SHOPIFY_WEBHOOK_SECRET` = the client
secret. Deploy ≠ activate: the install route 503s until both id and secret are set.

## 5. Acceptance criteria (proposed)

- AC-1 A portal client with a `.myshopify.com` domain reaches Shopify's consent screen and comes
  back to a pending Shopify connection with a masked identifier; no token appears in the
  browser, logs or audit rows.
- AC-2 The callback rejects: missing/tampered `hmac`; unknown, expired, consumed or mismatched
  `state`; a `shop` outside the regex or different from the state's shop; a state minted for
  another client. All 403, all audited, none persist anything.
- AC-3 Tokens are expiring offline tokens; the refresh path rotates and persists the pair
  atomically, serialised per shop; a revoked token flips the connection to Reconnect and the
  "Reconnect with Shopify" button re-runs the install for the same row (merge, not 409).
- AC-4 The approval gate is unchanged: an installed store is `source='portal', active=false`,
  invisible to both pollers; after operator approval PrepShip's sync pulls the store's orders
  with the OAuth token, deduplicated as today.
- AC-5 `app/uninstalled` deactivates and clears the pair; the compliance topics behave per
  Shopify; webhooks are attributable to the store.
- AC-6 The credential path (Client ID/secret, pasted token) still works as "Use app credentials
  instead" (D6).
- AC-7 Proofs in §6 are green in CI at the exact SHA; no production store is connected during
  testing (development store only).

## 6. Tests and guards

- `scripts/shopify-oauth-connect-guard.ts` (PrepShip, hermetic, enrolled in `sot-guard-pack`):
  authorize URL exact param set; redirect derivation/override; HMAC accepts the official sorted
  hex vector and rejects tampered/missing; shop regex rejects `x.myshopify.com.attacker.example`;
  exchange posts `expiring=1`; refresh persists the rotated refresh token; 401 → reauth.
- `scripts/audit-imported-handler-boundary-guard.ts`: handler count pin bumped in the same commit.
- Real-PostgreSQL integration (PrepShip harness on PG17): state mint → consume once → replay
  403; callback with stubbed fetch inserts `portal/false`, credentials keys exactly the OAuth
  shape; second callback for the same shop MERGES; sync ignores pending; approval → sync uses the
  token; refresh rotation under two concurrent callers keeps one valid pair.
- Portal: `guard:portal-store-connect` extended (install forces clientId from scope; no
  `accessToken:` literal echoed; audit field names only); `shopify-connect.integration.ts` gains
  the OAuth seed path; Playwright: the button sends the intent and the pending card renders.
- Mutation harness entries for each security check (HMAC off, state check off, regex off,
  merge → insert), each killed by its guard.

## 7. Known gaps this contract must decide on (not silently fix)

- Cross-app reconnect gap: PrepShip deactivates after 3 auth failures; the portal's reconnect
  never re-activates. Fix here (callback/reconnect re-activates when `source='admin'`) or
  separate card.
- `src/routes/webhooks.ts` carries an `unlock shipped data` header (2026-06-09); editing
  webhook binding may need a fresh override from DJ.
- PrepShip `guard:portal-shopify-integrations` and `guard:shopify-sync-source` are ungated;
  promote under `OFFLINE_GUARD_ENV` before touching those files.

## 8. DJ decisions (each with a recommendation)

- **D1 App model / distribution.** *Recommend:* ONE PrepShip-owned public app with limited
  visibility (unlisted) — the only model that lets separate merchants sign in with one click.
  Cost: App Store review, PCD Level 2, compliance webhooks, expiring tokens. Alternative: keep
  per-client custom apps (today) — no review, but no one-click sign-in.
- **D2 Callback + refresh owner.** *Recommend:* prepship-v4 API (`PUBLIC_API_URL`, already mounts
  `/oauth`, house pattern, single poller); the portal exposes a thin proxied install start.
- **D3 Auto-approve after install?** *Recommend:* no — keep the operator gate (2026-07-08 spine).
- **D4 Scopes.** *Recommend:* the portal's 10 required scopes (fulfillment writes are needed for
  shipment confirmation); no `read_all_orders` at install.
- **D5 Token at rest.** *Recommend:* add an envelope-encryption owner (AES-256-GCM, key in env)
  for the OAuth pair in this card; Hermes's proof list asks for encrypted persistence and
  nothing in either repo provides it today.
- **D6 Keep the credential path** as "Use app credentials instead". *Recommend:* yes.
- **D7 Land `#1243` UPS first** (fix its handler-count pin) so Shopify reuses a green `/oauth`
  router, or build Shopify directly on stable. *Recommend:* build on stable; land UPS separately.

## 9. What DJ must do before any live test (Dev Dashboard)

1. https://dev.shopify.com/dashboard → Apps → Create app → "Start from Dev Dashboard" → name
   "PrepShip".
2. Configure a version: App URL (non-embedded may use `https://shopify.dev/apps/default-app-home`
   or the portal URL), Webhooks API version, scopes per D4 → Release.
3. Distribution per D1 (public + limited visibility recommended); request Protected Customer
   Data Level 2; plan the App Store review submission.
4. Register the redirect URL exactly: `https://prepshipv4-api-l5xc.onrender.com/oauth/shopify/callback`
   (plus a staging/localhost one if wanted).
5. Settings → copy Client ID + Client secret → Render env on prepshipv4-api (`SHOPIFY_CLIENT_ID`,
   `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_WEBHOOK_SECRET`); set `PUBLIC_API_URL` or
   `SHOPIFY_OAUTH_REDIRECT_URI`.
6. Create a development store for testing; until review passes only development stores can
   install the app. No production store is connected during testing.

## 10. Non-goals

Embedded app / App Bridge / token-exchange grant; historical backfill (`read_all_orders`);
changes to the ShipStation→Shopify cutover; migrating existing credential-based stores to
OAuth (they keep working); any production data mutation.

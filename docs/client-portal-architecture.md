# Client Portal Architecture

## Purpose

The client portal is an invite-only, read-only foundation over PrepShip data. The UI can keep the existing dashboard modules, but client-facing reads must pass through `/api/client-portal/*` instead of broad internal PrepShip routes.

## Access Model

- Portal access is invite-only.
- DR PREPPER USA provisions the Supabase user and assigns portal scope before the user can see data.
- Public signup is not allowed.
- Password reset remains available so invited users can set or recover credentials.

## Scope Model

The first foundation batch uses the current Supabase JWT claim model:

- `clientIds` defines visible PrepShip clients.
- `storeIds` defines visible source stores.
- `client_user` and `read_only_support` must have at least one assigned client/store scope.
- Filters can narrow assigned scope, but must never expand it.
- Admin/global users can see global data only through explicit role, admin email, or `scope:global`.

## API Boundary

The dedicated client portal route family is:

```text
/api/client-portal/*
```

Required read routes:

- `GET /api/client-portal/me`
- `GET /api/client-portal/dashboard`
- `GET /api/client-portal/orders`
- `GET /api/client-portal/orders/:id`
- `GET /api/client-portal/shipments`
- `GET /api/client-portal/inventory`
- `GET /api/client-portal/analysis`
- `GET /api/client-portal/reports`
- `GET /api/client-portal/integrations`
- `GET /api/client-portal/activity`

Existing internal APIs remain available for operator/admin surfaces, but portal dashboard reads should use `portalApi.clientPortal.*`.

## Safe DTO Rules

Client portal responses must use safe DTO mappers and omit:

- credentials and credential blobs
- Supabase/service tokens, auth headers, cookies, API keys, and passwords
- raw provider payloads
- internal notes
- raw label links and label payloads
- financial fields unless the caller has explicit `financials:read`

## Audit

The foundation records portal audit events through a redacted helper. The initial helper is append-ready and strips sensitive metadata before logging. A future batch can persist these events to a durable append-only table and expose a client-safe activity feed.

## Deferred Work

- Admin portal-user provisioning workflow.
- Client-portal integration write routes.
- Durable `audit_events` table and client-visible activity history.
- Full unit/component/E2E test stack beyond the current static guards and smoke coverage.


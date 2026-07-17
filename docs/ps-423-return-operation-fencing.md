# PS-423 — Client Portal return-operation fencing

Client Portal return-label purchases now fail closed across concurrent requests,
timeouts, process failure, and late workers while keeping `shipments` as the
canonical label/tracking/rate/cost source.

## Changes

- Added generation and lease-token fencing to the existing CP-057 return-label
  purchase coordinator.
- Propagated abort signals into ShipStation create and reconciliation requests.
- Kept provider receipts durable before canonical shipment persistence.
- Removed automatic repurchase after a provider lookup returns 404.
- Added an admin-only provider-verified no-effect resolution that records actor,
  note, and time before a new purchase generation can be claimed.
- Extended the hosted-Postgres fault suite with provider-absence hold,
  operator-authorized retry, and stale-generation rejection cases.
- Added additive migration `0047` plus a migration-first Render one-off runner.

## Source-of-truth boundary

`return_label_purchase_intents` coordinates the external side effect only.
`shipments` remains the purchased return label, tracking, selected rate, cost,
and customer-money source. The portal frontend receives only the existing
customer-safe return DTO.

## Local verification

Strict backend/portal typecheck, production portal build, CP-057/CP-043/return
schema and label guards, shadow-renderer guard, architecture guard, and runtime
DDL guard pass. No configured provider or database was contacted. The DB-backed
integration remains CI-gated because this workstation has no throwaway
`TEST_DATABASE_URL` or Docker runtime.

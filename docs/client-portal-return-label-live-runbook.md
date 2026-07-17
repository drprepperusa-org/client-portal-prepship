# Client Portal return-label live runbook (CP-057)

This runbook controls the first real Client Portal return-label purchase. Real
postage is a money-moving production action. Keep `RETURNS_LIVE_LABELS=false`
unless every gate below passes and DJ gives explicit approval immediately
before the canary.

## Safety model

- `shipments` is the canonical label, tracking, selected-rate, and cost owner.
- `return_label_purchase_intents` coordinates one external side effect per
  return. Its selected-rate and provider-receipt snapshots exist only for
  crash recovery and are cleared after the canonical shipment is linked.
- Every provider request carries the intent's stable
  `provider_reference_key` as ShipStation `external_shipment_id`.
- `purchasing` blocks a concurrent owner. `unknown_outcome` must reconcile by
  external shipment id before another purchase is allowed.
- A completed retry reads the existing shipment and repairs the workflow link;
  it never submits another label request.
- `clients.is_test=true` always uses the offline mock, even when the live flag
  is enabled.

## Enablement gates

All gates are required:

1. Apply `drizzle/0041_return_label_purchase_intents.sql` using the normal
   production migration owner. Confirm the table and both unique indexes exist.
2. Confirm the CP-057 static guard, DB-backed integration suite, full guard
   suite, TypeScript checks, portal build, and UI tests are green for the exact
   deployed commit.
3. Confirm Render and Vercel deploy the same commit.
4. Confirm `/health`, `/health/deep`, and `/health/ready` are healthy. Run at
   least five serial readiness probes and three concurrent probes; any timeout
   or 503 blocks the canary.
5. Confirm the ShipStation account can list carriers, return a fresh eligible
   rate, and retrieve a label by `external_shipment_id`. Do not buy postage in
   this preflight.
6. Confirm `RETURNS_LIVE_LABELS` is still false and the designated test client
   still produces only `source='test_offline'` labels.
7. Obtain DJ's explicit approval for one controlled real-postage canary.

## One-label canary

1. Record the approved return id, order id, expected package facts, operator,
   timestamp, deployed commit, and approval reference.
2. Enable `RETURNS_LIVE_LABELS` for the API service only.
3. Submit one label request for the approved non-test return.
4. Verify exactly one purchase intent, one provider label, one canonical return
   shipment, and one `returns.return_shipment_id` link.
5. Verify the intent is `completed` and its recovery JSON fields are null.
6. Retry the same label action once. Verify it returns the same shipment and
   tracking number and does not increase the provider label count.
7. Verify the label PDF opens, the customer rate matches backend billing policy,
   and the Client Portal response contains no carrier, service, provider,
   selected-rate, external-reference, or raw-cost fields.
8. Disable the live flag after the canary unless DJ explicitly approves wider
   enablement.

## Stop and reconcile

Immediately set `RETURNS_LIVE_LABELS=false` if readiness fails, the provider
outcome is unknown, persistence fails, the customer contract leaks internals,
or counts differ.

For `unknown_outcome`, look up the stable provider reference first. If a label
exists, reconcile it forward into the canonical shipment and return workflow.
A provider 404 is not proof that the earlier request had no effect and must not
reclaim the intent. Keep it held until an operator verifies no label exists and
records the audited no-effect resolution. Never blindly retry a timed-out
purchase. Do not void a real label or buy a replacement
without the production owner's explicit approval.

Record final evidence: commit, deploy ids, readiness results, return id, intent
id/state, redacted provider reference suffix, shipment id, provider label count,
retry result, and rollback/flag state. Never paste credentials or raw provider
payloads into logs, Trello, or screenshots.

# Client Portal return-label live runbook (CP-057)

This runbook controls the first real Client Portal return-label purchase. Real
postage is a money-moving production action. Keep `RETURNS_LIVE_LABELS=false`
unless every gate below passes and DJ gives explicit approval immediately
before the canary.

With the flag off, real clients fail closed and no tracking number, PDF, return
shipment, or `label_created` state is manufactured. The offline mock path is
reserved for records explicitly marked as test clients.

## Safety model

- `shipments` is the canonical label, tracking, selected-rate, and cost owner.
- `return_label_purchase_intents` coordinates one external side effect per
  return. Its selected-rate and provider-receipt snapshots exist only for
  crash recovery and are cleared after the canonical shipment is linked.
- Every provider request carries the intent's stable
  `provider_reference_key` as ShipStation `external_shipment_id`.
- Live purchase and external tracking both lock the same `returns` row before
  claiming its label slot. The purchase commits intent ownership before any
  provider call; external tracking inserts its shipment and links the slot in
  one transaction. A loser receives `409 label_assignment_in_progress` and
  writes no shipment.
- `purchasing` blocks a concurrent owner. `unknown_outcome` must reconcile by
  external shipment id before another purchase is allowed.
- A completed retry reads the existing shipment and repairs the workflow link;
  it never submits another label request.
- `clients.is_test=true` always uses the offline mock, even when the live flag
  is enabled.
- An external PDF may update only the same active external shipment still
  linked to the locked return. If ownership changes after upload, cleanup of the
  new private object is attempted and the DB path is never written.

## Schema preflight (no label or billing side effect)

Apply migrations only through the normal production migration owner and only
after explicit approval for that exact database. Keep `RETURNS_LIVE_LABELS=false`
throughout this work.

1. Confirm `0041_return_label_purchase_intents.sql` and
   `0045_return_label_purchase_intents_rls.sql` are present in migration history.
2. Inspect `drizzle/0047_return_label_operation_fencing.sql` without applying it:
   `npm run migrate:ps-423-return-label-fencing`.
3. If 0047 is missing and the owner approves it, run:
   `npm run migrate:ps-423-return-label-fencing -- --apply --confirm=apply-ps-423-return-label-fencing-0047`.
4. Inspect `drizzle/0049_return_label_purchase_intent_voided.sql` without applying it:
   `npm run migrate:cp-057-return-label-voided`.
5. If 0049 is missing and the owner separately approves it, run:
   `npm run migrate:cp-057-return-label-voided -- --apply --confirm=apply-cp-057-return-label-voided-0049 --host=<exact_database_host> --database=<exact_database_name>`.
6. Save the readback proving `voided` is accepted by the state constraint,
   existing-row count/fingerprint is unchanged, RLS remains enabled, and the
   two 0041 unique indexes, the 0041 state index, and the 0047 lease index all
   remain present.

## Enablement gates

All gates are required:

1. Complete the schema preflight above. Confirm the table, both unique indexes,
   0047 lease fence, 0049 `voided` state, and deny-all RLS boundary exist.
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
7. Obtain DJ's explicit approval naming one controlled real-postage canary,
   its maximum postage, and the void/stop plan.

## CP-058 external/start-only certification

Use designated safe returns only. With live labels disabled, verify start-only,
external tracking, optional private PDF, and staff-only billing-date correction.
Verify the activity/audit evidence, RBAC, and cross-client isolation. Race two
external assignments and both purchase/external winner orders in the throwaway
integration suite; never manufacture a production race.

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
8. If DJ separately approves the bounded billing proof, temporarily enable the
   canonical PrepShip `RETURN_BILLING_ENABLED` lane for this canary only. Prove
   exactly one return-postage line and one `$2.50` processing line. Client Portal
   remains a read-only renderer and must not generate either line.
9. Set both `RETURNS_LIVE_LABELS=false` and `RETURN_BILLING_ENABLED=false`
   afterward unless DJ explicitly approves wider enablement.

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

If the bounded billing proof was enabled, also set
`RETURN_BILLING_ENABLED=false` in the canonical PrepShip service before leaving
the canary lane. Do not regenerate, edit, or delete billing lines from Client
Portal.

Record final evidence: commit, deploy ids, readiness results, return id, intent
id/state, redacted provider reference suffix, shipment id, provider label count,
retry result, and rollback/flag state. Never paste credentials or raw provider
payloads into logs, Trello, or screenshots.

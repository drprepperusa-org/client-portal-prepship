// @ts-nocheck
// Extracted verbatim from api/carriers/labels.ts (C2 decomposition). The
// direct-label endpoint handler dispatches here; behavior is unchanged.
import { assertFulfillmentSchemaReady } from '../../../../src/services/fulfillment/schema-readiness.js';

export function inferStoreProviderFromExternalId(externalOrderId: string | null | undefined): string {
  if (!externalOrderId) return 'shipstation';
  const match = externalOrderId.match(/^([a-z_]+)-(.+)$/i);
  return match?.[1]?.toLowerCase() ?? 'shipstation';
}

export function sourceOrderIdFromExternalId(externalOrderId: string | null | undefined): string | null {
  if (!externalOrderId) return null;
  const match = externalOrderId.match(/^[a-z_]+-(.+)$/i);
  return match?.[1] ?? externalOrderId;
}

async function ensureFulfillmentOutboxSql(sql: any): Promise<void> {
  // Per user override unlock shipped data on 2026-05-23: remove
  // request-time shipment/outbox DDL and require migration-owned schema.
  await assertFulfillmentSchemaReady(sql);
}

export async function enqueueShipmentConfirmationSql(
  sql: any,
  args: {
    orderId: number;
    shipmentId: number;
    externalOrderId: string | null;
    clientId: number | null;
    orderNumber: string | null;
    trackingNumber: string;
    carrierCode: string | null;
    carrierProvider: string;
    carrierAccountId: number | string | null;
    confirmationProvider?: string | null;
    shipDate?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<{ queued: boolean; provider: string }> {
  await ensureFulfillmentOutboxSql(sql);
  const provider = args.confirmationProvider ?? inferStoreProviderFromExternalId(args.externalOrderId);
  const supported = provider === 'shipstation' || provider === 'walmart' || provider === 'ebay';
  await sql`
    UPDATE orders
    SET
      source_provider = COALESCE(source_provider, ${provider}),
      source_order_id = COALESCE(source_order_id, ${sourceOrderIdFromExternalId(args.externalOrderId)}),
      source_order_number = COALESCE(source_order_number, ${args.orderNumber}),
      canonical_status = CASE
        WHEN ${supported} THEN 'shipped_pending_confirmation'
        ELSE COALESCE(canonical_status, order_status)
      END,
      updated_at = NOW()
    WHERE id = ${args.orderId}
  `;
  await sql`
    UPDATE shipments
    SET
      carrier_provider = ${args.carrierProvider},
      carrier_account_id = ${args.carrierAccountId == null ? null : String(args.carrierAccountId)},
      confirmation_provider = ${provider},
      confirmation_status = ${supported ? 'pending' : 'not_required'},
      confirmation_last_error = ${supported ? null : `${provider} confirmation connector is not implemented yet`},
      updated_at = NOW()
    WHERE id = ${args.shipmentId}
  `;
  if (!supported) return { queued: false, provider };

  const payload = {
    ...args.payload,
    orderId: args.orderId,
    shipmentId: args.shipmentId,
    externalOrderId: args.externalOrderId,
    clientId: args.clientId,
    orderNumber: args.orderNumber,
    trackingNumber: args.trackingNumber,
    carrierCode: args.carrierCode,
    carrierProvider: args.carrierProvider,
    carrierAccountId: args.carrierAccountId,
    shipDate: args.shipDate ?? new Date().toISOString().slice(0, 10),
  };
  const dedupeKey = `shipment_confirmation_requested:${provider}:${args.orderId}:${args.shipmentId}`;
  await sql`
    INSERT INTO fulfillment_outbox (
      order_id, shipment_id, event_type, provider, dedupe_key, payload,
      status, attempts, next_run_at, updated_at
    )
    VALUES (
      ${args.orderId}, ${args.shipmentId}, 'shipment_confirmation_requested',
      ${provider}, ${dedupeKey}, ${sql.json(payload)}, 'pending', 0, NOW(), NOW()
    )
    ON CONFLICT (dedupe_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      status = CASE
        WHEN fulfillment_outbox.status = 'succeeded' THEN fulfillment_outbox.status
        ELSE 'pending'
      END,
      next_run_at = CASE
        WHEN fulfillment_outbox.status = 'succeeded' THEN fulfillment_outbox.next_run_at
        ELSE NOW()
      END,
      updated_at = NOW()
  `;
  return { queued: true, provider };
}

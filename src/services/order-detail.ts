// Order detail payload shaping — extracted verbatim from routes/orders.ts
// (C3 decomposition). GET /orders/:id and /orders/:id/full render this.
import {
  buildCanonicalOrderModel,
  finiteNumberOrNull,
  resolveLegacyClientId,
} from './order-canonical';

export function buildOrderDetailPayload(
  order: Record<string, unknown>,
  overrides: Record<string, unknown> | null,
  shipmentRows: unknown[],
) {
  const legacyClientId = resolveLegacyClientId(
    finiteNumberOrNull(order.clientId),
    finiteNumberOrNull(order.storeId),
  );
  const canonicalOrder = buildCanonicalOrderModel(
    order,
    overrides,
    legacyClientId,
    {},
  );

  return {
    ...order,
    legacyClientId,
    client: canonicalOrder.client,
    canonicalOrder,
    overrides,
    shipments: shipmentRows,
  };
}

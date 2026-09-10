import { hasActiveOutboundShipmentSql, hasVoidedOutboundShipmentSql } from './order-lifecycle';

// PS-486 shares ONE read-only projection of the order's shipment facts between the Orders
// list, the order detail, and the transactional return-request recheck, so no consumer can
// classify an order from different evidence than another.
//
// CP-069: the facts are PrepShip's aggregate rule — the order's OUTBOUND rows only
// (`voided`, `is_return = false`), matched by order_id or the client-scoped order_number
// fallback (order-lifecycle.ts). Carrier tracking status is deliberately NOT a signal: the
// customer fulfillment display and the return-request policy read PrepShip's fulfillment
// truth, never carrier progress. An inbound return label cannot establish that the original
// order shipped.
export function orderFulfillmentSignalSelects() {
  return {
    hasActiveOutboundShipment: hasActiveOutboundShipmentSql(),
    hasVoidedOutboundShipment: hasVoidedOutboundShipmentSql(),
  };
}

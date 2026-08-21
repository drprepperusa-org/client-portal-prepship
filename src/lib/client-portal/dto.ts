import type { Inventory } from '../../db/schema/inventory';
import type { OrderItem } from '../../db/schema/order-items';
import type { Order, OrderOverrides } from '../../db/schema/orders';
import type { Shipment } from '../../db/schema/shipments';
import type { InboundShipment, InboundItem } from '../../db/schema/inbound';
import { isDiscountLine } from './dashboard-aggregate';
import { trackingUrlForCarrier } from '../tracking-url';
import { maskAccountIdentifier } from '../credential-accounts';
import { resolveOrderFulfillmentStatus } from './order-status';
import { normalizePortalShipmentStatus } from './shipment-status';
import type { PortalItemIdentity } from './contracts/common';
import type { PortalInbound } from './contracts/inbound';
import type { PortalInventory } from './contracts/inventory';
import { classifyStockStatus } from '../inventory-stock-status';
import type { PortalOrder, PortalOrderCostSummaryRow } from './contracts/orders';
import type { PortalShipment } from './contracts/shipments';
import {
  PORTAL_CONNECTION_STATUSES,
  PORTAL_RECONNECT_REASON_CODES,
  type PortalConnectionStatus,
  type PortalIntegration,
  type PortalReconnectReasonCode,
} from './contracts/connections';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}


export function safeItems(value: unknown, includeFinancials = false): PortalItemIdentity[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => !isDiscountLine(item))
    .slice(0, 30)
    .map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const quantity = Number(row.quantity ?? row.qty);
    const unitPrice = row.unitPrice ?? row.unit_price ?? row.price;
    return {
      sku: typeof row.sku === 'string' ? row.sku : null,
      name: typeof row.name === 'string' ? row.name : null,
      quantity: Number.isFinite(quantity) ? quantity : null,
      ...(includeFinancials
        ? { unitPrice: typeof unitPrice === 'number' || typeof unitPrice === 'string' ? unitPrice : null }
        : {}),
      imageUrl:
        typeof row.imageUrl === 'string'
          ? row.imageUrl
          : typeof row.image_url === 'string'
            ? row.image_url
            : typeof row.thumbnailUrl === 'string'
              ? row.thumbnailUrl
              : null,
    };
  });
}

/** CP-017 — a single customer-facing cost-summary row. */
export type PortalCostKind = PortalOrderCostSummaryRow['kind'];
export type PortalCostRow = PortalOrderCostSummaryRow;

/** Integer-cent helpers — money is never summed or compared as floats. */
const toCents = (n: number): number => Math.round((Number(n) || 0) * 100);
const fromCents = (c: number): number => c / 100;

/** Read one numeric money value from the narrow whitelisted money shape.
 *  Accepts number or numeric-string; returns 0 for missing / non-finite.
 *  Deliberately receives a PRE-EXTRACTED whitelist, NEVER the raw jsonb column —
 *  carrier/rate/account keys are structurally unreachable here. */
function moneyKey(src: { taxAmount?: unknown } | undefined, key: 'taxAmount'): number {
  const v = src?.[key];
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * CP-017 — build the customer-facing cost summary for an order.
 *
 * INVARIANT: Σ(cents of every non-'total' row) === round(orderTotal × 100), and
 * the 'total' row === orderTotal, for EVERY provider. A single balancing row
 * (refund on a cancelled negative residual, else a sign-aware adjustment)
 * absorbs any residual, so the receipt always closes to the cent.
 *
 * Real sources only (all orders flow through ShipStation V1 — no native Shopify
 * payload is stored): subtotal = Σ cents of the returned items' lineTotal (so it
 * matches the per-item money(lineTotal) column); discount = Σ negative promo LINE
 * items (`canonicalItems` excludes them, so read the ORIGINAL items); shipping =
 * customerShippingRate; tax = raw.taxAmount (manual orders only). The whitelisted
 * `money` never carries carrier/service/account fields.
 */
function buildCostSummary(args: {
  orderTotal: number | string | null | undefined;
  orderStatus: string | null | undefined;
  /** The DTO's returned normalized items (discount-stripped) with canonical
   *  lineTotal attached — the SAME array the panel renders. */
  items: PortalItemIdentity[];
  /** The ORIGINAL compatibility items so negative promo lines are visible. */
  rawItems: unknown;
  customerShippingRate: number | string | null | undefined;
  /** Narrow, pre-extracted money whitelist — NEVER the raw jsonb column. */
  money: { taxAmount?: unknown } | undefined;
}): PortalCostRow[] {
  const rows: PortalCostRow[] = [];
  const totalCents = toCents(args.orderTotal as number);

  // subtotal: Σ integer-cents of each returned line's lineTotal — equals the sum
  // of the per-item money(lineTotal) column to the cent.
  let subtotalCents = 0;
  for (const it of args.items) {
    const lt = Number(it.lineTotal);
    if (Number.isFinite(lt)) subtotalCents += toCents(lt);
  }
  if (subtotalCents !== 0) {
    rows.push({ label: 'Subtotal', amount: fromCents(subtotalCents), kind: 'subtotal' });
  }

  // discount: Σ negative promo LINE items (the only real discount source).
  let discountCents = 0;
  if (Array.isArray(args.rawItems)) {
    for (const raw of args.rawItems) {
      if (!isDiscountLine(raw)) continue;
      const r = raw as Record<string, unknown>;
      const price = Number(r.unitPrice ?? r.unit_price ?? r.price);
      const qty = Number(r.quantity ?? r.qty ?? 1) || 1;
      if (Number.isFinite(price)) discountCents += toCents(price * qty); // negative
    }
  }
  if (discountCents !== 0) {
    rows.push({ label: 'Discount', amount: fromCents(discountCents), kind: 'discount' });
  }

  const shippingCents = toCents(args.customerShippingRate as number);
  if (shippingCents !== 0) {
    rows.push({ label: 'Shipping', amount: fromCents(shippingCents), kind: 'shipping' });
  }

  const taxCents = toCents(moneyKey(args.money, 'taxAmount'));
  if (taxCents !== 0) {
    rows.push({ label: 'Tax', amount: fromCents(taxCents), kind: 'tax' });
  }

  // balancing row (the guarantee) — sign- and status-aware label.
  const knownCents = rows.reduce((c, r) => c + toCents(r.amount), 0);
  const residualCents = totalCents - knownCents;
  if (Math.abs(residualCents) >= 1) {
    const status = String(args.orderStatus ?? '').toLowerCase();
    const isVoided = status === 'cancelled' || status === 'canceled' || status === 'refunded';
    if (residualCents < 0 && isVoided) {
      rows.push({ label: 'Refund', amount: fromCents(residualCents), kind: 'refund' });
    } else if (residualCents < 0) {
      rows.push({ label: 'Adjustment', amount: fromCents(residualCents), kind: 'adjustment' });
    } else {
      // A POSITIVE residual (unmodeled fee/surcharge/tip) must NOT read as a discount.
      rows.push({ label: 'Other', amount: fromCents(residualCents), kind: 'adjustment' });
    }
  }

  rows.push({ label: 'Order total', amount: fromCents(totalCents), kind: 'total' });
  return rows;
}

export function toPortalInboundDto(
  row: InboundShipment & { clientName?: string | null },
  items: InboundItem[] = [],
): PortalInbound {
  const expectedUnits = items.reduce((n, it) => n + (Number(it.expectedQty) || 0), 0);
  const receivedUnits = items.reduce((n, it) => n + (Number(it.receivedQty) || 0), 0);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName ?? null,
    reference: row.reference,
    supplier: row.supplier,
    status: row.status,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    expectedDate: iso(row.expectedDate),
    receivedDate: iso(row.receivedDate),
    notes: row.notes,
    createdAt: iso(row.createdAt),
    expectedUnits,
    receivedUnits,
    items: items.map((it) => ({
      id: it.id,
      sku: it.sku,
      name: it.name,
      expectedQty: it.expectedQty,
      receivedQty: it.receivedQty,
    })),
  };
}

export function toPortalOrderDto(
  row: Order & {
    clientName?: string | null;
    storeName?: string | null;
    override?: OrderOverrides | null;
    /** Billed shipping for this order (Σ billing_line_items line_type='shipping')
     *  — the customer-facing shipping charge, supplied by the route layer. */
    shippingCharged?: number | string | null;
    /** Canonical signals for the backend-owned fulfillment-status resolver
     *  (order-status.ts), supplied by the read-model from the shipments table. */
    activeTrackingStatus?: string | null;
    hasActiveShipment?: boolean;
    hasVoidedShipment?: boolean;
    /** Complete normalized item rows from order_items. orders.items remains
     *  compatibility input for legacy discount/address metadata only. */
    canonicalItems: Array<
      Pick<OrderItem, 'sku' | 'name' | 'quantity' | 'unitPrice' | 'lineTotal' | 'imageUrl'>
    >;
    /** Latest active shipment identity, selected by the order read-model. */
    activeShipmentTrackingNumber?: string | null;
    activeShipmentCarrierCode?: string | null;
    /** CP-061: backend-derived REPLACE badge fields, supplied by the order
     *  read-model's readiness-gated badge selects. */
    hasActiveReplacement?: boolean;
    replacementStatus?: string | null;
    replacementCount?: number;
    replacementReference?: string | null;
  },
  options: { includeFinancials?: boolean; includeWeight?: boolean } = {}
): PortalOrder & { carrierCode: null; serviceCode: null; shippingService: null } {
  // CP-018/CP-040: the client portal shows ONLY the resolved customer shipping
  // rate. Buyer-paid store shipping and the internal
  // selected/label/best rate, carrier, service, and provider-account nickname
  // are never computed into or projected onto the client DTO.
  // CP-014: product line totals + subtotal are backend-owned money. Map canonical
  // order_items.line_total and sum the product subtotal here so the frontend only
  // renders them. Both are financially gated.
  // CP-052: order_items is the canonical owner for item identity, quantity, and
  // line money. The complete array crosses the DTO boundary with no silent cap.
  // orders.items is retained below only for legacy promo/address compatibility;
  // malformed raw quantity can never change orderedUnits or a displayed line.
  const items: PortalItemIdentity[] = row.canonicalItems.map((it) => ({
    sku: it.sku,
    name: it.name,
    quantity: Number(it.quantity),
    ...(options.includeFinancials
      ? { unitPrice: Number(it.unitPrice), lineTotal: Number(it.lineTotal) }
      : {}),
    imageUrl: it.imageUrl,
  }));
  const orderedUnits = row.canonicalItems.reduce((sum, it) => sum + Number(it.quantity), 0);
  const productSubtotal = items.reduce((sum, it) => sum + (Number(it.lineTotal) || 0), 0);
  const activeShipmentTrackingNumber = row.activeShipmentTrackingNumber?.trim() || null;
  const legacyOverrideTrackingNumber = row.override?.trackingNumber?.trim() || null;
  const displayTrackingNumber = activeShipmentTrackingNumber ?? legacyOverrideTrackingNumber;
  // Full customer ship-to address. Street lines live in the raw marketplace
  // payload (there is no dedicated column); city/state/postal are columns. This
  // is the CLIENT's own recipient — not provider/internal data — so it is not
  // financially gated (only carrier/service/money are).
  const rawShipTo =
    row.raw && typeof row.raw === 'object'
      ? ((row.raw as Record<string, unknown>).shipTo as Record<string, unknown> | undefined)
      : undefined;
  const shipToStr = (key: string): string | null => {
    const value = rawShipTo?.[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName ?? row.storeName ?? null,
    storeId: row.storeId,
    storeName: row.storeName ?? row.clientName ?? null,
    orderNumber: row.orderNumber,
    externalOrderId: row.externalOrderId,
    sourceProvider: row.sourceProvider,
    sourceStoreId: row.sourceAccountId,
    orderStatus: row.orderStatus,
    // Backend-owned order fulfillment status (Pending / In Transit / Delivered /
    // Cancelled / Voided). Resolved by resolveOrderFulfillmentStatus from the
    // order status + the order's shipment voided/tracking truth — the frontend
    // renders this enum, it never re-derives the status. See order-status.ts.
    fulfillmentStatus: resolveOrderFulfillmentStatus({
      orderStatus: row.orderStatus,
      activeTrackingStatus: row.activeTrackingStatus ?? null,
      hasActiveShipment: row.hasActiveShipment ?? false,
      hasVoidedShipment: row.hasVoidedShipment ?? false,
    }),
    // CP-061: backend-derived REPLACE badge — rendered verbatim by the client,
    // never re-derived from replacement rows in React.
    hasActiveReplacement: row.hasActiveReplacement ?? false,
    replacementStatus: row.replacementStatus ?? null,
    replacementCount: row.replacementCount ?? 0,
    replacementReference: row.replacementReference ?? null,
    orderDate: iso(row.orderDate),
    shipToName: row.shipToName,
    shipToLine1: shipToStr('street1'),
    shipToLine2: shipToStr('street2'),
    shipToCity: row.shipToCity,
    shipToState: row.shipToState,
    shipToPostalCode: row.shipToPostalCode ?? shipToStr('postalCode'),
    shipToCountry: shipToStr('country'),
    // CP-009: the client portal is customer-facing, so carrier / shipping-
    // service identity is NEVER exposed here — not even to financials-enabled
    // clients or admins. Clients track packages by number, not by carrier. The
    // shipping AMOUNT stays (financially gated); only the identity is stripped.
    carrierCode: null,
    serviceCode: null,
    // Canonical display tracking comes from the latest active shipment. The
    // override is a documented legacy fallback for orders not linked to a
    // shipment yet; competing raw tracking fields never cross the DTO boundary.
    displayTrackingNumber,
    // CP-034: backend-built OFFICIAL carrier tracking URL (USPS/UPS/FedEx) so the
    // order-detail tracking number links to the real carrier site, never 17track.
    // Carrier identity stays redacted (carrierCode/serviceCode null above); only the
    // URL — whose destination happens to be carrier-specific — crosses the wire.
    // null when the carrier is unknown, so the number renders as plain text.
    trackingUrl:
      trackingUrlForCarrier(
        activeShipmentTrackingNumber ? row.activeShipmentCarrierCode : row.carrierCode,
        displayTrackingNumber,
      ) || null,
    shippingService: null,
    items,
    // Backend-owned sum of canonical order_items.quantity at order time.
    orderedUnits,
    ...(options.includeWeight ? { weightOz: row.weightOz ?? null } : {}),
    ...(options.includeFinancials
      ? (() => {
          // CP-018 / CP-040: the ONE customer-facing shipping value is the backend
          // resolver's C. Shipping Rate — a frozen billing_line_items shipping line
          // per shipment, else PrepShip's policy-versioned shipment snapshot (read in
          // lib/client-portal/customer-shipping-rate.ts and surfaced here as
          // shippingCharged by read-models/orders.ts + the shipment read-models).
          // Buyer-paid store shipping (orders.shippingAmount) is UNRELATED to the
          // 3PL customer shipping rate and is NEVER a fallback for it (CP-040).
          // NEVER the internal selected/label/best rate either.
          const customerShippingRate =
            Number(row.shippingCharged) > 0 ? row.shippingCharged : null;
          // CP-017: extract ONLY the money keys the summary needs from raw — never
          // pass the full jsonb column (it carries marketplace carrier / rate /
          // account fields that CP-009/CP-018 forbid surfacing).
          const rawObj =
            row.raw && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : undefined;
          return {
            orderTotal: row.orderTotal,
            // Resolver-owned customer shipping charge (frozen billing line →
            // projection). orders.shippingAmount (buyer-paid store shipping) is
            // intentionally NOT exposed — it is unrelated to the rate (CP-040).
            shippingCharged: row.shippingCharged ?? null,
            customerShippingRate,
            // The order shipped (has an active shipment) but its shipping line
            // isn't billed yet → the client sees "Pending" instead of a bare "—",
            // so a not-yet-invoiced charge doesn't read as "no shipping". Backend-
            // owned: the frontend renders this flag, it never decides WHEN it is
            // pending. A genuinely-null rate with no shipment stays "—".
            customerShippingRatePending: customerShippingRate == null && Boolean(row.hasActiveShipment),
            // CP-014: backend-owned product subtotal (Σ line totals).
            productSubtotal,
            // CP-017/CP-038: backend-owned, always-reconciling charge summary (client-
            // facing name; buildCostSummary is the internal owner). Non-'total' rows
            // sum to orderTotal to the cent (a balancing refund/adjustment row absorbs
            // any residual). Financially gated — absent for callers without money
            // access, so the panel renders nothing.
            chargeSummary: buildCostSummary({
              orderTotal: row.orderTotal,
              orderStatus: row.orderStatus,
              items, // returned items (discount-stripped, lineTotal attached)
              rawItems: row.items, // original items (negative promo lines intact)
              customerShippingRate,
              money: { taxAmount: rawObj?.taxAmount },
            }),
          };
        })()
      : {}),
  };
}

export function toPortalShipmentDto(
  row: Shipment & {
    clientName?: string | null;
    storeName?: string | null;
    storeId?: number | null;
    orderItems?: unknown;
    shippingCost?: number | string | null;
    shipmentStatus?: unknown;
  },
  options: { includeFinancials?: boolean } = {},
): PortalShipment & { carrierCode: null; serviceCode: null } {
  // Display tracking identity is selected once at the backend boundary. The
  // frozen label result is canonical; trackingNumber is the legacy shipment
  // fallback. Raw competing fields never cross into the customer DTO.
  const displayTrackingNumber = row.labelTracking ?? row.trackingNumber ?? null;
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    clientId: row.clientId,
    clientName: row.clientName ?? row.storeName ?? null,
    storeId: row.storeId ?? null,
    storeName: row.storeName ?? row.clientName ?? null,
    // CP-009: carrier/service identity is never exposed in the client portal.
    carrierCode: null,
    serviceCode: null,
    displayTrackingNumber,
    shipmentStatus: normalizePortalShipmentStatus(row.shipmentStatus),
    // CP-034: a backend-built OFFICIAL carrier tracking URL (USPS/UPS/FedEx) so
    // the link opens the real carrier site, never 17track. The carrier identity
    // stays redacted (carrierCode/serviceCode above are null) — only the URL,
    // built from the canonical labelCarrier (SOT at label time; carrierCode is
    // the pre-label attempt), crosses the wire. '' when carrier is unknown.
    trackingUrl:
      trackingUrlForCarrier(
        row.labelCarrier ?? row.carrierCode,
        displayTrackingNumber,
      ) || null,
    shipDate: iso(row.shipDate ?? row.labelShipDate ?? row.createDate),
    shipmentStatusDetail: row.trackingStatusDetail ?? null,
    deliveredAt: iso(row.deliveredAt),
    items: safeItems(row.orderItems, options.includeFinancials),
    customerShippingRate: options.includeFinancials ? row.shippingCost ?? null : null,
    // A live (non-voided) shipment with no billed shipping line yet is awaiting
    // billing → the client sees "Pending" rather than "—". Backend-owned flag;
    // see toPortalOrderDto for the same convention.
    customerShippingRatePending: Boolean(
      options.includeFinancials && row.shippingCost == null && !row.voided,
    ),
  };
}

export function toPortalInventoryDto(
  row: Inventory & {
    // CP-023: warehouse ship-out units (inventory_ledger ship rows, by ship
    // date) — NOT ordered/sold units. The SOT-encoding name prevents confusion
    // with Analysis's "Ordered Units".
    warehouseShipped30d?: number | string | null;
    inventoryQuantity: number | string;
    clientName?: string | null;
    storeName?: string | null;
    storeIds?: number[] | null;
    pkg?: { name: string | null; length: number | null; width: number | null; height: number | null } | null;
  },
): PortalInventory {
  const length = row.length ?? null;
  const width = row.width ?? null;
  const height = row.height ?? null;
  // Cubic feet per unit: explicit override, else derived from L×W×H (in³ → ft³).
  const cuFt =
    row.cuFtOverride != null
      ? Number(row.cuFtOverride)
      : length != null && width != null && height != null
        ? Number(((length * width * height) / 1728).toFixed(3))
        : null;
  const baseUnitQty = row.baseUnitQty ?? 1;
  const stock = Number(row.inventoryQuantity);
  const reorder = Number(row.reorderLevel ?? 0);
  const stockStatus = classifyStockStatus(stock, reorder);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName ?? row.storeName ?? null,
    storeIds: row.storeIds ?? [],
    storeName: row.storeName ?? row.clientName ?? null,
    sku: row.sku,
    name: row.name,
    inventoryQuantity: stock,
    reorderLevel: row.reorderLevel,
    active: row.active,
    imageUrl: row.imageUrl,
    warehouseShipped30d: Number(row.warehouseShipped30d ?? 0),
    // CP-013 / PS-378: backend-owned stock status (the frontend renders this enum).
    stockStatus,
    updatedAt: iso(row.updatedAt),
    // ── v4 Stock-Levels parity fields ──
    length,
    width,
    height,
    cuFt,
    unitsPerPack: row.unitsPerPack ?? 1,
    baseUnitQty,
    packageName: row.pkg?.name ?? null,
    packageLength: row.pkg?.length ?? null,
    packageWidth: row.pkg?.width ?? null,
    packageHeight: row.pkg?.height ?? null,
  };
}

export {
  PORTAL_CONNECTION_STATUSES,
  PORTAL_RECONNECT_REASON_CODES,
  type PortalConnectionStatus,
  type PortalReconnectReasonCode,
};

function portalReconnectReasonCode(error: string | null | undefined): PortalReconnectReasonCode | null {
  const normalized = error?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'auth' || normalized === 'invalid_credentials') {
    return 'authentication_required';
  }
  if (normalized === 'missing_scopes' || normalized.includes('scope')) {
    return 'permissions_required';
  }
  if (normalized === 'misconfigured' || normalized === 'no-client' || normalized === 'token_exchange') {
    return 'configuration_required';
  }
  return null;
}

/**
 * CP-054 connection policy.
 *
 * Owner: backend integration read-model. Inputs are the canonical store/carrier
 * account source, active flag, and latest sync error. The frontend only renders
 * this enum; raw policy inputs and detailed sync errors never cross the DTO.
 */
export function resolvePortalConnectionStatus(row: {
  source?: string | null;
  type?: string;
  active?: boolean | null;
  lastSyncError?: string | null;
}): { connectionStatus: PortalConnectionStatus; reconnectReasonCode: PortalReconnectReasonCode | null } {
  if (row.type === 'store' && row.source === 'portal') {
    return { connectionStatus: 'pending', reconnectReasonCode: null };
  }
  const reconnectReasonCode = portalReconnectReasonCode(row.lastSyncError);
  if (reconnectReasonCode) return { connectionStatus: 'reconnect', reconnectReasonCode };
  if (row.lastSyncError) return { connectionStatus: 'degraded', reconnectReasonCode: null };
  return {
    connectionStatus: (row.active ?? true) ? 'active' : 'inactive',
    reconnectReasonCode: null,
  };
}

export function toPortalIntegrationDto(row: {
  id?: number;
  clientId?: number | null;
  provider?: string | null;
  label?: string | null;
  accountIdentifier?: string | null;
  source?: string | null;
  type?: string;
  assignedClientIds?: number[];
  clientName?: string | null;
  storeName?: string | null;
  storeIds?: number[] | null;
  active?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  lastSyncError?: string | null;
  lastSyncedAt?: Date | string | null;
}): PortalIntegration {
  const status = resolvePortalConnectionStatus(row);
  return {
    id: row.id,
    clientId: row.clientId ?? null,
    provider: row.provider ?? null,
    label: row.label ?? null,
    // Masking happens at the backend boundary. The raw seller ID, shop domain,
    // or account number is never serialized into customer JSON.
    displayAccountIdentifier: maskAccountIdentifier(row.accountIdentifier ?? null),
    connectionStatus: status.connectionStatus,
    reconnectReasonCode: status.reconnectReasonCode,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    type: row.type ?? 'carrier',
    assignedClientIds: row.assignedClientIds ?? [],
    clientName: row.clientName ?? row.storeName ?? null,
    storeName: row.storeName ?? row.clientName ?? null,
    storeIds: row.storeIds ?? [],
    // Tenant connection freshness is the canonical store_accounts clock.
    lastSyncedAt: iso(row.lastSyncedAt ?? null),
  };
}

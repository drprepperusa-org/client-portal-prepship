import type { Inventory } from '../../db/schema/inventory';
import type { Order, OrderOverrides } from '../../db/schema/orders';
import type { Shipment } from '../../db/schema/shipments';
import type { InboundShipment, InboundItem } from '../../db/schema/inbound';
import { isDiscountLine } from './dashboard-aggregate';
import { trackingUrlForCarrier } from '../tracking-url';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}


export function safeItems(value: unknown, includeFinancials = false): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => !isDiscountLine(item))
    .slice(0, 30)
    .map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      sku: typeof row.sku === 'string' ? row.sku : null,
      name: typeof row.name === 'string' ? row.name : null,
      quantity: row.quantity ?? row.qty ?? null,
      ...(includeFinancials ? { unitPrice: row.unitPrice ?? row.unit_price ?? row.price ?? null } : {}),
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
export type PortalCostKind =
  | 'subtotal'
  | 'discount'
  | 'shipping'
  | 'tax'
  | 'adjustment'
  | 'refund'
  | 'total';
export interface PortalCostRow {
  label: string;
  amount: number; // dollars, 2-dp; negative for discount/refund/negative adjustment
  kind: PortalCostKind;
}

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
 * items (safeItems strips them, so read the ORIGINAL items); shipping =
 * customerShippingRate; tax = raw.taxAmount (manual orders only). The whitelisted
 * `money` never carries carrier/service/account fields.
 */
function buildCostSummary(args: {
  orderTotal: number | string | null | undefined;
  orderStatus: string | null | undefined;
  /** The DTO's returned items (post-safeItems, discount-stripped) with lineTotal
   *  attached — the SAME array the panel renders. */
  items: Array<Record<string, unknown>>;
  /** The ORIGINAL items (pre-safeItems) so negative promo lines are visible. */
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
) {
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
  },
  options: { includeFinancials?: boolean } = {}
) {
  // CP-018: the client portal shows ONLY the customer shipping rate (billed
  // customer shipping, falling back to buyer-paid store shipping). The internal
  // selected/label/best rate, carrier, service, and provider-account nickname
  // are never computed into or projected onto the client DTO.
  // CP-014: product line totals + subtotal are backend-owned money. Compute the
  // per-line total (unitPrice × quantity) and the order product subtotal here so
  // the frontend renders them instead of multiplying unit prices itself. Both
  // are financially gated: with no financial access, safeItems omits unitPrice,
  // no lineTotal is attached, and the subtotal stays 0 (and is not returned).
  const items = safeItems(row.items, options.includeFinancials);
  if (options.includeFinancials) {
    for (const it of items) {
      const price = Number(it.unitPrice);
      const qty = Number(it.quantity) || 1;
      it.lineTotal = Number.isFinite(price) ? price * qty : null;
    }
  }
  const productSubtotal = items.reduce((sum, it) => sum + (Number(it.lineTotal) || 0), 0);
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
    trackingNumber: row.override?.trackingNumber ?? null,
    shippingService: null,
    items,
    ...(options.includeFinancials
      ? (() => {
          // CP-018: the ONE customer-facing shipping value. Billed customer
          // shipping when > 0, else buyer-paid store shipping when > 0, else null
          // → "—". NEVER the internal selected/label/best rate. Computed once and
          // reused for the shipping row of the cost summary.
          const customerShippingRate =
            Number(row.shippingCharged) > 0
              ? row.shippingCharged
              : Number(row.shippingAmount) > 0
                ? row.shippingAmount
                : null;
          // CP-017: extract ONLY the money keys the summary needs from raw — never
          // pass the full jsonb column (it carries marketplace carrier / rate /
          // account fields that CP-009/CP-018 forbid surfacing).
          const rawObj =
            row.raw && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : undefined;
          return {
            orderTotal: row.orderTotal,
            shippingAmount: row.shippingAmount,
            // Billed shipping (Σ billing_line_items shipping) — the customer-facing
            // shipping charge, replacing carrier/service.
            shippingCharged: row.shippingCharged ?? null,
            customerShippingRate,
            // CP-014: backend-owned product subtotal (Σ line totals).
            productSubtotal,
            // CP-017: backend-owned, always-reconciling cost summary. Non-'total'
            // rows sum to orderTotal to the cent (a balancing refund/adjustment row
            // absorbs any residual). Financially gated — absent for callers without
            // money access, so the panel renders nothing.
            costSummary: buildCostSummary({
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
  },
  options: { includeFinancials?: boolean } = {},
) {
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
    trackingNumber: row.trackingNumber,
    labelTracking: row.labelTracking,
    // CP-034: a backend-built OFFICIAL carrier tracking URL (USPS/UPS/FedEx) so
    // the link opens the real carrier site, never 17track. The carrier identity
    // stays redacted (carrierCode/serviceCode above are null) — only the URL,
    // built from the canonical labelCarrier (SOT at label time; carrierCode is
    // the pre-label attempt), crosses the wire. '' when carrier is unknown.
    trackingUrl:
      trackingUrlForCarrier(
        row.labelCarrier ?? row.carrierCode,
        row.labelTracking ?? row.trackingNumber,
      ) || null,
    shipDate: iso(row.shipDate ?? row.labelShipDate ?? row.createDate),
    trackingStatus: row.trackingStatus ?? null,
    trackingStatusDetail: row.trackingStatusDetail ?? null,
    deliveredAt: iso(row.deliveredAt),
    voided: row.voided,
    items: safeItems(row.orderItems, options.includeFinancials),
    customerShippingRate: options.includeFinancials ? row.shippingCost ?? null : null,
  };
}

export function toPortalInventoryDto(
  row: Inventory & {
    // CP-023: warehouse ship-out units (inventory_ledger ship rows, by ship
    // date) — NOT ordered/sold units. The SOT-encoding name prevents confusion
    // with Analysis's "Ordered Units".
    warehouseShipped30d?: number | string | null;
    effectiveStock?: number | string | null;
    clientName?: string | null;
    storeName?: string | null;
    storeIds?: number[] | null;
    pkg?: { name: string | null; length: number | null; width: number | null; height: number | null } | null;
  },
) {
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
  // CP-013 / PS-378: stock status is backend-owned so the Low/Out filter and
  // the status badge share ONE definition. The source input is effectiveStock
  // from src/services/inventory-stock-math, not raw cached inventory.stockQty:
  //   out = effectiveStock <= 0
  //   low = reorderLevel > 0 and effectiveStock <= reorderLevel
  const stock = Number(row.effectiveStock ?? row.stockQty ?? 0);
  const reorder = Number(row.reorderLevel ?? 0);
  const isOut = stock <= 0;
  const isLow = reorder > 0 && stock <= reorder;
  const stockStatus: 'out' | 'low' | 'in' = isOut ? 'out' : isLow ? 'low' : 'in';
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName ?? row.storeName ?? null,
    storeIds: row.storeIds ?? [],
    storeName: row.storeName ?? row.clientName ?? null,
    sku: row.sku,
    name: row.name,
    stockQty: row.stockQty,
    reorderLevel: row.reorderLevel,
    active: row.active,
    imageUrl: row.imageUrl,
    warehouseShipped30d: Number(row.warehouseShipped30d ?? 0),
    effectiveStock: stock,
    // CP-013 / PS-378: backend-owned stock status (the frontend renders this enum).
    stockStatus,
    isLow,
    isOut,
    updatedAt: iso(row.updatedAt),
    // ── v4 Stock-Levels parity fields ──
    length,
    width,
    height,
    cuFt,
    unitsPerPack: row.unitsPerPack ?? 1,
    baseUnitQty,
    totalUnits: stock * baseUnitQty,
    packageName: row.pkg?.name ?? null,
    packageLength: row.pkg?.length ?? null,
    packageWidth: row.pkg?.width ?? null,
    packageHeight: row.pkg?.height ?? null,
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
}) {
  return {
    id: row.id,
    clientId: row.clientId ?? null,
    provider: row.provider ?? null,
    label: row.label ?? null,
    accountIdentifier: row.accountIdentifier ?? null,
    source: row.source ?? null,
    active: row.active ?? true,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    type: row.type ?? 'carrier',
    assignedClientIds: row.assignedClientIds ?? [],
    clientName: row.clientName ?? row.storeName ?? null,
    storeName: row.storeName ?? row.clientName ?? null,
    storeIds: row.storeIds ?? [],
  };
}

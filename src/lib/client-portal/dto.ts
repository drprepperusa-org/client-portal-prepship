import type { Inventory } from '../../db/schema/inventory';
import type { Order, OrderOverrides } from '../../db/schema/orders';
import type { Shipment } from '../../db/schema/shipments';
import type { InboundShipment, InboundItem } from '../../db/schema/inbound';
import { isDiscountLine } from './dashboard-aggregate';

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
      weightOz: row.weightOz ?? row.weight_oz ?? null,
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
    weightOz: row.weightOz,
    rateWeightOz: row.override?.rateWeightOz ?? null,
    shippingService: null,
    items,
    ...(options.includeFinancials
      ? {
          orderTotal: row.orderTotal,
          shippingAmount: row.shippingAmount,
          // Billed shipping (Σ billing_line_items shipping) — the customer-facing
          // shipping charge, replacing carrier/service.
          shippingCharged: row.shippingCharged ?? null,
          // CP-018: the ONE customer-facing shipping value. Billed customer
          // shipping when > 0, else buyer-paid store shipping when > 0, else null
          // → "—". NEVER the internal selected/label/best rate. The > 0 guards
          // preserve today's OrderDetailPanel semantics: a '0.00' billed value
          // means "not billed yet" and must fall through to store shipping, not
          // render $0.00. Financially gated like the other money fields.
          customerShippingRate:
            Number(row.shippingCharged) > 0
              ? row.shippingCharged
              : Number(row.shippingAmount) > 0
                ? row.shippingAmount
                : null,
          // CP-014: backend-owned product subtotal (Σ line totals).
          productSubtotal,
        }
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
    shipDate: iso(row.shipDate ?? row.labelShipDate ?? row.createDate),
    trackingStatus: row.trackingStatus ?? null,
    trackingStatusDetail: row.trackingStatusDetail ?? null,
    deliveredAt: iso(row.deliveredAt),
    voided: row.voided,
    items: safeItems(row.orderItems, options.includeFinancials),
    shippingCost: options.includeFinancials ? row.shippingCost ?? null : null,
  };
}

export function toPortalInventoryDto(
  row: Inventory & {
    soldLast30Days?: number | string | null;
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
  // CP-013: stock status is backend-owned so the Low/Out filter and the status
  // badge share ONE definition. Mirrors the read-model's lowStock predicate:
  //   out  = stockQty <= 0
  //   low  = reorderLevel > 0 and stockQty <= reorderLevel
  //   (lowStock filter = out OR low; OUT wins for the display label)
  const stock = Number(row.stockQty ?? 0);
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
    soldLast30Days: Number(row.soldLast30Days ?? 0),
    effectiveStock: row.stockQty,
    // CP-013: backend-owned stock status (the frontend renders this enum).
    stockStatus,
    isLow,
    isOut,
    updatedAt: iso(row.updatedAt),
    // ── v4 Stock-Levels parity fields ──
    weightOz: row.weightOz ?? null,
    length,
    width,
    height,
    cuFt,
    unitsPerPack: row.unitsPerPack ?? 1,
    baseUnitQty,
    totalUnits: (row.stockQty ?? 0) * baseUnitQty,
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

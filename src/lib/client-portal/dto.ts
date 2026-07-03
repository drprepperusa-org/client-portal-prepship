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

// Friendly carrier service names for the "Shipping Account" sub-line, matching
// v4's display. The best rate usually carries a friendly serviceName/
// service_type already; this map only covers orders that have nothing but a
// raw service_code (e.g. plain "ups_ground" on a synced shipment).
const SERVICE_NAME_BY_CODE: Record<string, string> = {
  ups_ground: 'UPS Ground',
  ups_standard: 'UPS Standard',
  ups_surepost_1_lb_or_greater: 'UPS Ground Saver (1 lb+)',
  ups_surepost_less_than_1_lb: 'UPS Ground Saver (< 1 lb)',
  ups_surepost_bound_printed_matter: 'UPS Ground Saver (BPM)',
  ups_surepost_media: 'UPS Ground Saver (Media)',
  ups_next_day_air: 'UPS Next Day Air',
  ups_next_day_air_saver: 'UPS Next Day Air Saver',
  ups_next_day_air_early_am: 'UPS Next Day Air Early',
  ups_2nd_day_air: 'UPS 2nd Day Air',
  ups_2nd_day_air_am: 'UPS 2nd Day Air AM',
  ups_3_day_select: 'UPS 3 Day Select',
  ups_worldwide_saver: 'UPS Worldwide Saver',
  ups_worldwide_expedited: 'UPS Worldwide Expedited',
  usps_ground_advantage: 'USPS Ground Advantage',
  usps_parcel_select: 'USPS Parcel Select',
  usps_parcel_select_ground: 'USPS Parcel Select',
  usps_media_mail: 'USPS Media Mail',
  usps_library_mail: 'USPS Library Mail',
  usps_priority_mail: 'USPS Priority Mail',
  usps_priority_mail_express: 'USPS Priority Mail Express',
  usps_first_class_mail: 'USPS First Class',
  fedex_ground: 'FedEx Ground',
  fedex_home_delivery: 'FedEx Home Delivery',
  fedex_2day: 'FedEx 2Day',
  fedex_2day_am: 'FedEx 2Day AM',
  fedex_express_saver: 'FedEx Express Saver',
  fedex_standard_overnight: 'FedEx Standard Overnight',
  fedex_priority_overnight: 'FedEx Priority Overnight',
  fedex_first_overnight: 'FedEx First Overnight',
  fedex_international_economy: 'FedEx International Economy',
  fedex_international_priority: 'FedEx International Priority',
};

/** Strip the ® mark and collapse whitespace from a friendly service name. */
function cleanServiceName(value: string): string {
  return value.replace(/®/g, '').replace(/\s+/g, ' ').trim();
}

/** Resolve a friendly service name from a raw service code. */
function friendlyServiceFromCode(code?: string | null): string | null {
  if (!code) return null;
  const c = code.toLowerCase().trim();
  if (SERVICE_NAME_BY_CODE[c]) return SERVICE_NAME_BY_CODE[c];
  // Generic prettify: "some_service_code" → "Some Service Code".
  const pretty = c.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim();
  return pretty || null;
}

function stringFromRecord(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function numberFromRecord(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const direct = Number(record[key]);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const value = record[key];
    if (value && typeof value === 'object' && 'amount' in (value as Record<string, unknown>)) {
      const nested = Number((value as Record<string, unknown>).amount);
      if (Number.isFinite(nested) && nested > 0) return nested;
    }
  }
  return null;
}

function rateAmountFromRecord(record: Record<string, unknown> | null): number | null {
  const direct = numberFromRecord(record, ['cost', 'rate', 'amount', 'shipmentCost', 'shipment_cost', 'totalCost', 'total']);
  if (direct != null) return direct;
  const shipping = numberFromRecord(record, ['shipping_amount']) ?? 0;
  const other = numberFromRecord(record, ['other_amount']) ?? 0;
  const confirmation = numberFromRecord(record, ['confirmation_amount']) ?? 0;
  const total = shipping + other + confirmation;
  return total > 0 ? total : null;
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
    /**
     * Resolved nickname of the account on the order's active shipment
     * (shipments.provider_account_id → nickname). Authoritative for
     * shipped/cancelled orders; supplied by the route layer.
     */
    shipmentAccount?: string | null;
    latestShipment?: {
      carrierCode?: string | null;
      serviceCode?: string | null;
      serviceName?: string | null;
      amount?: number | string | null;
      selectedRateJson?: Record<string, unknown> | null;
    } | null;
  },
  options: { includeFinancials?: boolean } = {}
) {
  const bestRateJson = row.override?.bestRateJson ?? null;
  // "Shipping Account" source-of-truth chain (per parity/ORDERS_VIEW_COLUMN_TRACE):
  //   1. manual override (operator-set)              — always wins
  //   2. the actual account billed on the shipment   — shipped/cancelled
  //   3. the selected/best rate's carrier account     — awaiting (from rate JSON)
  // bestRateJson comes in two shapes: the worker's camelCase shape
  // (carrierNickname) and our backfill's ShipStation snake_case shape
  // (carrier_nickname). Read both so the account fills regardless of writer.
  const br = bestRateJson && typeof bestRateJson === 'object' ? (bestRateJson as Record<string, unknown>) : null;
  const bestRateAccount =
    (br?.carrier_nickname as string | undefined) ?? (br?.carrierNickname as string | undefined) ?? null;
  const shippingAccount =
    row.override?.shippingAccount ?? row.shipmentAccount ?? bestRateAccount ?? null;
  // Friendly service label: prefer the rate's own friendly name (worker
  // `serviceName` or backfill `service_type`), else map the raw code.
  const bestRateServiceName =
    (br?.serviceName as string | undefined) ?? (br?.service_type as string | undefined) ?? null;
  const shippingService = bestRateServiceName
    ? cleanServiceName(bestRateServiceName)
    : friendlyServiceFromCode((br?.service_code as string | undefined) ?? (br?.serviceCode as string | undefined) ?? row.serviceCode);
  // Carrier (matches v4): awaiting orders show the *selected best-rate* carrier
  // (the order's carrierCode isn't set until a label is bought, and can even be
  // stale), while shipped/cancelled show the actual carrier that shipped.
  const bestRateCarrierCode =
    (br?.carrierCode as string | undefined) ?? (br?.carrier_code as string | undefined) ?? null;
  const isAwaiting = row.orderStatus === 'awaiting_shipment';
  const selectedRateJson =
    row.latestShipment?.selectedRateJson && typeof row.latestShipment.selectedRateJson === 'object'
      ? (row.latestShipment.selectedRateJson as Record<string, unknown>)
      : null;
  const selectedRateCarrierCode =
    row.latestShipment?.carrierCode ??
    stringFromRecord(selectedRateJson, ['carrierCode', 'carrier_code', 'carrier']) ??
    null;
  const selectedRateServiceCode =
    row.latestShipment?.serviceCode ??
    stringFromRecord(selectedRateJson, ['serviceCode', 'service_code']) ??
    null;
  const selectedRateServiceName =
    row.latestShipment?.serviceName ??
    stringFromRecord(selectedRateJson, ['serviceName', 'service_name', 'service_type']) ??
    friendlyServiceFromCode(selectedRateServiceCode);
  const selectedRateAmount =
    row.latestShipment?.amount != null && Number(row.latestShipment.amount) > 0
      ? row.latestShipment.amount
      : rateAmountFromRecord(selectedRateJson);
  const selectedRate =
    !isAwaiting && (selectedRateCarrierCode || selectedRateServiceCode || selectedRateServiceName || selectedRateAmount != null)
      ? {
          carrierCode: selectedRateCarrierCode,
          serviceCode: selectedRateServiceCode,
          serviceName: selectedRateServiceName ? cleanServiceName(selectedRateServiceName) : null,
          amount: options.includeFinancials ? selectedRateAmount : null,
          source: 'shipment' as const,
        }
      : null;
  const carrierCode = isAwaiting
    ? (bestRateCarrierCode ?? row.carrierCode)
    : (selectedRateCarrierCode ?? row.carrierCode ?? bestRateCarrierCode);
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
    shipToCity: row.shipToCity,
    shipToState: row.shipToState,
    // CP-009: carrier/shipping-service identity is internal operational data —
    // gated exactly like shippingAccount/money fields. Clients keep tracking
    // numbers but never see which carrier/service was used.
    carrierCode: options.includeFinancials ? carrierCode : null,
    serviceCode: options.includeFinancials ? row.serviceCode : null,
    trackingNumber: row.override?.trackingNumber ?? null,
    weightOz: row.weightOz,
    rateWeightOz: row.override?.rateWeightOz ?? null,
    shippingService: options.includeFinancials ? shippingService : null,
    selectedRate: options.includeFinancials
      ? selectedRate
      : selectedRate && { ...selectedRate, carrierCode: null, serviceCode: null, serviceName: null },
    items,
    ...(options.includeFinancials
      ? {
          // Carrier-account nickname is operator/internal — gated like the
          // financial fields so the client-facing portal never exposes it (CP-001).
          shippingAccount,
          orderTotal: row.orderTotal,
          shippingAmount: row.shippingAmount,
          // CP-014: backend-owned product subtotal (Σ line totals).
          productSubtotal,
          // CP-015: normalized best-rate amount. The frontend renders this and
          // never parses raw bestRateJson; the raw provider payload is not
          // exposed on the client DTO at all.
          bestRateAmount: rateAmountFromRecord(br),
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
    // CP-009: carrier/service identity gated like the financial fields —
    // client users track packages by number, not by carrier.
    carrierCode: options.includeFinancials ? row.carrierCode : null,
    serviceCode: options.includeFinancials ? row.serviceCode : null,
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

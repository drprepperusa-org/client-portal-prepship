import type { Inventory } from '../../db/schema/inventory';
import type { Order, OrderOverrides } from '../../db/schema/orders';
import type { Shipment } from '../../db/schema/shipments';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function safeItems(value: unknown, includeFinancials = false): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((item) => {
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

export function toPortalOrderDto(
  row: Order & {
    clientName?: string | null;
    storeName?: string | null;
    override?: OrderOverrides | null;
  },
  options: { includeFinancials?: boolean } = {}
) {
  const bestRateJson = row.override?.bestRateJson ?? null;
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
    carrierCode: row.carrierCode,
    serviceCode: row.serviceCode,
    trackingNumber: row.override?.trackingNumber ?? null,
    weightOz: row.weightOz,
    rateWeightOz: row.override?.rateWeightOz ?? null,
    shippingAccount: row.override?.shippingAccount ?? null,
    items: safeItems(row.items, options.includeFinancials),
    ...(options.includeFinancials
      ? {
          orderTotal: row.orderTotal,
          shippingAmount: row.shippingAmount,
          bestRateJson,
        }
      : {}),
  };
}

export function toPortalShipmentDto(row: Shipment & { clientName?: string | null; storeName?: string | null; storeId?: number | null }) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    clientId: row.clientId,
    clientName: row.clientName ?? row.storeName ?? null,
    storeId: row.storeId ?? null,
    storeName: row.storeName ?? row.clientName ?? null,
    carrierCode: row.carrierCode,
    serviceCode: row.serviceCode,
    trackingNumber: row.trackingNumber,
    labelTracking: row.labelTracking,
    shipDate: iso(row.shipDate ?? row.labelShipDate ?? row.createDate),
    voided: row.voided,
  };
}

export function toPortalInventoryDto(row: Inventory & { soldLast30Days?: number | string | null; clientName?: string | null; storeName?: string | null; storeIds?: number[] | null }) {
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
    soldLast30Days: row.soldLast30Days ?? 0,
    effectiveStock: row.stockQty,
    updatedAt: iso(row.updatedAt),
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

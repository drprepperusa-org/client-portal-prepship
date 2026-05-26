import type { Inventory } from '../../db/schema/inventory';
import type { Order } from '../../db/schema/orders';
import type { Shipment } from '../../db/schema/shipments';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function safeItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      sku: typeof row.sku === 'string' ? row.sku : null,
      name: typeof row.name === 'string' ? row.name : null,
      quantity: row.quantity ?? row.qty ?? null,
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

export function toPortalOrderDto(row: Order, options: { includeFinancials?: boolean } = {}) {
  return {
    id: row.id,
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
    items: safeItems(row.items),
    ...(options.includeFinancials
      ? {
          orderTotal: row.orderTotal,
          shippingAmount: row.shippingAmount,
        }
      : {}),
  };
}

export function toPortalShipmentDto(row: Shipment) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    clientId: row.clientId,
    carrierCode: row.carrierCode,
    serviceCode: row.serviceCode,
    trackingNumber: row.trackingNumber,
    labelTracking: row.labelTracking,
    shipDate: iso(row.shipDate ?? row.labelShipDate ?? row.createDate),
    voided: row.voided,
  };
}

export function toPortalInventoryDto(row: Inventory & { soldLast30Days?: number | string | null }) {
  return {
    id: row.id,
    clientId: row.clientId,
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
  };
}

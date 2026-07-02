// Orders CSV export shaping — extracted verbatim from routes/orders.ts
// (C3 decomposition). The /orders/export route queries rows + latest
// shipments, then delegates row shaping and financial redaction here.
import { orderOverrides, orders } from '../db/schema/orders';
import {
  finiteNumberOrNull,
  normalizeListBestRate,
  recordOrNull,
  stringOrNull,
} from './order-canonical';
import type { LatestShipmentRow } from './orders-list';

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function compactCsvValue(parts: unknown[], separator = ', '): string {
  return parts
    .map((part) => {
      if (part === null || part === undefined) return '';
      const value = String(part).trim();
      return value === 'null' || value === 'undefined' ? '' : value;
    })
    .filter(Boolean)
    .join(separator);
}

function formatCsvNumber(value: unknown, decimals = 2): string | number {
  const n = finiteNumberOrNull(value);
  if (n === null) return '';
  return Number.isInteger(n) ? n : Number(n.toFixed(decimals));
}

function formatCsvDimensions(
  length: unknown,
  width: unknown,
  height: unknown
): string {
  const dims = [
    ['L', finiteNumberOrNull(length)],
    ['W', finiteNumberOrNull(width)],
    ['H', finiteNumberOrNull(height)],
  ] as const;
  if (dims.every(([, value]) => value !== null)) {
    return dims.map(([, value]) => formatCsvNumber(value)).join(' x ');
  }
  return dims
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `${label} ${formatCsvNumber(value)}`)
    .join(' ');
}

function formatCsvItems(items: Array<Record<string, unknown>>): string {
  return items
    .map((item) => {
      const qty = finiteNumberOrNull(item.quantity);
      const sku = stringOrNull(item.sku);
      const name = stringOrNull(item.name);
      return compactCsvValue([qty !== null && qty > 0 ? `${qty}x` : '', sku, name], ' - ');
    })
    .filter(Boolean)
    .join(' | ');
}

function formatCsvSkuList(items: Array<Record<string, unknown>>): string {
  return [
    ...new Set(
      items
        .map((item) => stringOrNull(item.sku))
        .filter((sku): sku is string => Boolean(sku))
    ),
  ].join(', ');
}

// Body verbatim from the /export route; params are exactly the free
// variables the loop used there. canViewFinancials gating unchanged.
export function buildOrdersExportCsv(
  q: { status?: string },
  rows: Array<{ order: typeof orders.$inferSelect; overrides: typeof orderOverrides.$inferSelect | null }>,
  shipmentsByOrder: Map<number, LatestShipmentRow>,
  shipmentsByOrderNumber: Map<string, LatestShipmentRow>,
  canViewFinancials: boolean,
): string {
  const header = [
    'Order ID',
    'Order #',
    'Order Date',
    'Store ID',
    'Client ID',
    'Status',
    'Recipient',
    'Recipient Company',
    'Recipient Phone',
    'Ship To Address',
    'Ship To City',
    'Ship To State',
    'Ship To Postal Code',
    'Ship To Country',
    'Items',
    'Item Name',
    'SKU',
    'SKU List',
    'Qty',
    'Weight (oz)',
    'Carrier',
    'Service',
    'Carrier Account',
    'Package Type',
    'Package Dims (LxWxH)',
    'Delivery Days',
    'Estimated Delivery',
    'Tracking #',
    'Order Total',
    'Shipping Paid',
    'Best Rate',
    'Label Cost',
    'Ship Margin',
    'Label Created',
    'Shipped Date',
    'Age (hrs)',
  ];

  const lines: string[] = [header.join(',')];
  const now = Date.now();

  for (const { order, overrides } of rows) {
    const items = Array.isArray(order.items)
      ? (order.items as Array<Record<string, unknown>>)
      : [];
    const firstItem = items[0] ?? null;
    const itemName = stringOrNull(firstItem?.name) ?? '';
    const itemSku = stringOrNull(firstItem?.sku) ?? '';
    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const rawOrder = recordOrNull(order.raw) ?? {};
    const rawShipTo = recordOrNull(rawOrder.shipTo) ?? {};
    const shipToCity = stringOrNull(order.shipToCity) ?? stringOrNull(rawShipTo.city) ?? '';
    const shipToState = stringOrNull(order.shipToState) ?? stringOrNull(rawShipTo.state) ?? '';
    const shipToPostalCode =
      stringOrNull(order.shipToPostalCode) ??
      stringOrNull(rawShipTo.postalCode) ??
      stringOrNull(rawShipTo.postal_code) ??
      '';
    const shipToCountry =
      stringOrNull(rawShipTo.country) ??
      stringOrNull(rawShipTo.countryCode) ??
      stringOrNull(rawShipTo.country_code) ??
      '';
    const shipToAddress = compactCsvValue([
      rawShipTo.street1,
      rawShipTo.street2,
      rawShipTo.street3,
      compactCsvValue([shipToCity, shipToState, shipToPostalCode], ' '),
      shipToCountry,
    ]);

    const ship = shipmentsByOrder.get(order.id) ?? shipmentsByOrderNumber.get(order.orderNumber) ?? null;
    const isShippedExport = q.status === 'shipped' || order.orderStatus === 'shipped';
    const selectedRateObj =
      ship?.selected_rate_json && typeof ship.selected_rate_json === 'object'
        ? (ship.selected_rate_json as Record<string, unknown>)
        : null;
    const bestRateObj =
      isShippedExport
        ? selectedRateObj
        : selectedRateObj ?? (overrides?.bestRateJson as Record<string, unknown> | null | undefined);
    const normalizedBestRate = normalizeListBestRate(bestRateObj);
    const shipmentTotalCost =
      ship?.cost != null
        ? Number(ship.cost) + (ship.other_cost != null ? Number(ship.other_cost) : 0)
        : null;
    const labelCost = ship?.label_cost ?? (shipmentTotalCost != null ? shipmentTotalCost.toFixed(2) : '');
    const bestRateAmount = normalizedBestRate?.amount ?? (isShippedExport ? labelCost : '');

    const tracking = ship?.tracking_number ?? (isShippedExport ? '' : overrides?.trackingNumber ?? '');
    const labelCreated = ship?.label_created_at ?? ship?.create_date ?? ship?.ship_date ?? '';
    const carrier = normalizedBestRate?.carrierCode ?? ship?.carrier_code ?? '';
    const service =
      normalizedBestRate?.serviceName ??
      normalizedBestRate?.serviceCode ??
      ship?.service_code ??
      '';
    const carrierAccount =
      normalizedBestRate?.providerAccountNickname ??
      normalizedBestRate?.carrierNickname ??
      '';
    const packageType = normalizedBestRate?.packageType ?? '';
    const packageDims = formatCsvDimensions(
      overrides?.rateDimsL,
      overrides?.rateDimsW,
      overrides?.rateDimsH
    );
    const effectiveWeightOz = overrides?.rateWeightOz ?? order.weightOz;

    let shipMargin = '';
    if (labelCost !== '' && bestRateAmount !== '' && bestRateAmount != null) {
      const m = Number(labelCost) - Number(bestRateAmount);
      if (Number.isFinite(m)) shipMargin = m.toFixed(2);
    }
    const exportBestRateAmount = canViewFinancials ? bestRateAmount : '';
    const exportLabelCost = canViewFinancials ? labelCost : '';
    const exportShipMargin = canViewFinancials ? shipMargin : '';

    let ageHrs: string | number = '';
    if (order.orderDate) {
      const t = new Date(order.orderDate).getTime();
      if (!Number.isNaN(t)) ageHrs = Math.round((now - t) / 3_600_000);
    }

    lines.push(
      [
        order.id,
        order.orderNumber,
        order.orderDate,
        order.storeId,
        order.clientId,
        order.orderStatus,
        order.shipToName,
        rawShipTo.company,
        rawShipTo.phone,
        shipToAddress,
        shipToCity,
        shipToState,
        shipToPostalCode,
        shipToCountry,
        formatCsvItems(items),
        itemName,
        itemSku,
        formatCsvSkuList(items),
        totalQty || '',
        effectiveWeightOz,
        carrier,
        service,
        carrierAccount,
        packageType,
        packageDims,
        normalizedBestRate?.deliveryDays ?? '',
        normalizedBestRate?.estimatedDelivery ?? '',
        tracking,
        order.orderTotal,
        order.shippingAmount,
        exportBestRateAmount,
        exportLabelCost,
        exportShipMargin,
        labelCreated,
        ship?.ship_date ?? '',
        ageHrs,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `\ufeff${lines.join('\r\n')}\r\n`;
}

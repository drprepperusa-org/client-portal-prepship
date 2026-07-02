import { normalizeOrderBestRateDto } from './order-rate-dto';

/**
 * Canonical order model + source-attribution helpers (extracted verbatim from
 * routes/orders.ts). Pure normalization — no HTTP or DB concerns.
 */

export const LEGACY_CLIENT_ID_BY_STORE_ID = new Map<number, number>([
  [367706, 7],
  [363392, 8],
  [376661, 9],
  [277422, 10],
  [376827, 10],
]);

export const LEGACY_CLIENT_ID_BY_CURRENT_ID = new Map<number, number>([
  [8, 7],
  [9, 8],
  [10, 9],
  [11, 10],
  [12, 11],
]);

export type V2CarrierAccountRef = {
  carrierCode: string;
  shippingProviderId: number;
  nickname: string;
  clientId: number | null;
  accountNumber: string | null;
};

export type CanonicalSourceVersion = 'v1' | 'v2' | 'local' | 'derived';

export type CanonicalFieldSource = {
  version: CanonicalSourceVersion;
  source: string;
  via: string;
  note?: string;
};

export const V2_CARRIER_ACCOUNT_REFS: V2CarrierAccountRef[] = [
  { carrierCode: 'stamps_com', shippingProviderId: 433542, nickname: 'USPS Chase x7439', clientId: null, accountNumber: 'djeon-952w77' },
  { carrierCode: 'ups_walleted', shippingProviderId: 433543, nickname: 'UPS by SS - Chase x7439', clientId: null, accountNumber: 'ups_433543' },
  { carrierCode: 'ups', shippingProviderId: 565326, nickname: 'GG6381', clientId: null, accountNumber: 'GG6381' },
  { carrierCode: 'ups', shippingProviderId: 565377, nickname: 'G19Y32', clientId: null, accountNumber: 'G19Y32' },
  { carrierCode: 'ups', shippingProviderId: 596001, nickname: 'ORION', clientId: null, accountNumber: 'R05H19' },
  { carrierCode: 'ups', shippingProviderId: 604209, nickname: 'ROCEL', clientId: null, accountNumber: null },
  { carrierCode: 'ups', shippingProviderId: 607855, nickname: 'ROCEL C81F70', clientId: null, accountNumber: 'C81F70' },
  { carrierCode: 'fedex', shippingProviderId: 598840, nickname: 'FedEx', clientId: null, accountNumber: '208481048' },
  { carrierCode: 'fedex_walleted', shippingProviderId: 585004, nickname: 'FedEx One Balance', clientId: null, accountNumber: null },
  { carrierCode: 'stamps_com', shippingProviderId: 442006, nickname: 'GREG PAYABILITY 6/17', clientId: 10, accountNumber: null },
  { carrierCode: 'ups', shippingProviderId: 461890, nickname: 'ROCEL C81F70', clientId: 10, accountNumber: 'C81F70' },
  { carrierCode: 'ups', shippingProviderId: 565317, nickname: 'GG6381', clientId: 10, accountNumber: 'GG6381' },
  { carrierCode: 'ups', shippingProviderId: 595995, nickname: 'ORI Account', clientId: 10, accountNumber: 'R05H19' },
  { carrierCode: 'ups', shippingProviderId: 442007, nickname: 'GREG PAYABILITY 6/17', clientId: 10, accountNumber: null },
  { carrierCode: 'fedex', shippingProviderId: 442013, nickname: 'FedEx', clientId: 10, accountNumber: '208481048' },
  { carrierCode: 'fedex_walleted', shippingProviderId: 585334, nickname: 'FedEx One Balance', clientId: 10, accountNumber: null },
];

export function resolveLegacyClientId(
  clientId: number | null | undefined,
  storeId: number | null | undefined,
) {
  if (typeof storeId === 'number') {
    const byStore = LEGACY_CLIENT_ID_BY_STORE_ID.get(storeId);
    if (byStore != null) return byStore;
  }
  if (typeof clientId === 'number') {
    const byCurrentId = LEGACY_CLIENT_ID_BY_CURRENT_ID.get(clientId);
    if (byCurrentId != null) return byCurrentId;
  }
  return clientId ?? null;
}

export function resolveV2CarrierAccountRef(
  providerAccountId: number | null | undefined,
  carrierCode: string | null | undefined,
  trackingNumber: string | null | undefined,
  clientId: number | null,
): V2CarrierAccountRef | null {
  if (providerAccountId != null) {
    const exact = V2_CARRIER_ACCOUNT_REFS.find((account) => account.shippingProviderId === providerAccountId);
    if (exact) return exact;
  }

  if ((carrierCode === 'ups' || carrierCode === 'ups_walleted') && trackingNumber) {
    const tracking = trackingNumber.replace(/\s/g, '').toUpperCase();
    if (tracking.startsWith('1Z') && tracking.length >= 8) {
      const accountNumber = tracking.slice(2, 8);
      const matches = V2_CARRIER_ACCOUNT_REFS.filter(
        (account) =>
          (account.carrierCode === 'ups' || account.carrierCode === 'ups_walleted') &&
          account.accountNumber?.toUpperCase() === accountNumber,
      );
      const clientMatch = clientId != null ? matches.find((account) => account.clientId === clientId) : null;
      const sharedMatch = matches.find((account) => account.clientId === null);
      return clientMatch ?? sharedMatch ?? matches[0] ?? null;
    }
  }

  const matching = V2_CARRIER_ACCOUNT_REFS.filter((account) => account.carrierCode === carrierCode);
  if (matching.length === 1) return matching[0] ?? null;
  if (matching.length > 1) {
    const clientMatch = clientId != null ? matching.find((account) => account.clientId === clientId) : null;
    const sharedMatch = matching.find((account) => account.clientId === null);
    return clientMatch ?? sharedMatch ?? null;
  }

  return null;
}

export function normalizeListBestRate(value: unknown) {
  try {
    const bestRate = normalizeOrderBestRateDto(value);
    if (!bestRate) return null;
    const amount = bestRate.shipmentCost + bestRate.otherCost;
    if (!(amount > 0) && !(bestRate.carrierCode && bestRate.serviceCode)) return null;
    return {
      ...bestRate,
      amount,
      cost: amount,
      providerAccountId: bestRate.shippingProviderId,
      providerAccountNickname: bestRate.carrierNickname,
    };
  } catch {
    return null;
  }
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function providerIdOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/^se-(\d+)$/i);
  const parsed = Number.parseInt(match?.[1] ?? value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rateAmount(value: unknown): number | null {
  const rate = recordOrNull(value);
  if (!rate) return null;
  const shippingAmount = recordOrNull(rate.shipping_amount);
  const otherAmount = recordOrNull(rate.other_amount);
  const shipmentCost =
    finiteNumberOrNull(rate.shipmentCost) ??
    finiteNumberOrNull(shippingAmount?.amount) ??
    finiteNumberOrNull(rate.cost) ??
    finiteNumberOrNull(rate.amount);
  const otherCost = finiteNumberOrNull(rate.otherCost) ?? finiteNumberOrNull(otherAmount?.amount) ?? 0;
  return shipmentCost != null ? shipmentCost + otherCost : null;
}

export function sourceOf(
  version: CanonicalSourceVersion,
  source: string,
  via: string,
  note?: string,
): CanonicalFieldSource {
  return note ? { version, source, via, note } : { version, source, via };
}

export function pickStringSource(
  candidates: Array<{ value: unknown; source: CanonicalFieldSource }>,
): { value: string | null; source: CanonicalFieldSource } {
  for (const candidate of candidates) {
    const value = stringOrNull(candidate.value);
    if (value != null) return { value, source: candidate.source };
  }
  return {
    value: null,
    source: sourceOf('local', 'null', 'no populated source field'),
  };
}

export function pickNumberSource(
  candidates: Array<{ value: unknown; source: CanonicalFieldSource }>,
): { value: number | null; source: CanonicalFieldSource } {
  for (const candidate of candidates) {
    const value = finiteNumberOrNull(candidate.value);
    if (value != null) return { value, source: candidate.source };
  }
  return {
    value: null,
    source: sourceOf('local', 'null', 'no populated source field'),
  };
}

export function dateToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

export function buildCanonicalOrderModel(
  order: Record<string, unknown>,
  overrides: Record<string, unknown> | null,
  legacyClientId: number | null,
  shipping: Record<string, unknown>,
) {
  const raw = recordOrNull(order.raw) ?? {};
  const rawShipTo = recordOrNull(raw.shipTo) ?? {};
  const rawDimensions = recordOrNull(raw.dimensions) ?? {};
  const overrideDimensionLength = finiteNumberOrNull(overrides?.rateDimsL);
  const overrideDimensionWidth = finiteNumberOrNull(overrides?.rateDimsW);
  const overrideDimensionHeight = finiteNumberOrNull(overrides?.rateDimsH);
  const rawDimensionLength = finiteNumberOrNull(rawDimensions.length);
  const rawDimensionWidth = finiteNumberOrNull(rawDimensions.width);
  const rawDimensionHeight = finiteNumberOrNull(rawDimensions.height);
  const hasOverrideDimensions =
    overrideDimensionLength != null ||
    overrideDimensionWidth != null ||
    overrideDimensionHeight != null;

  const dimensionLength = overrideDimensionLength ?? rawDimensionLength;
  const dimensionWidth = overrideDimensionWidth ?? rawDimensionWidth;
  const dimensionHeight = overrideDimensionHeight ?? rawDimensionHeight;
  const dimensionSource =
    hasOverrideDimensions
      ? sourceOf('local', 'order_overrides.rateDims*', 'PrepShip dimension override')
      : dimensionLength != null && dimensionWidth != null && dimensionHeight != null && rawDimensions.length != null
      ? sourceOf('v1', 'orders.raw.dimensions', 'ShipStation v1 /orders.dimensions')
      : sourceOf('local', 'order_overrides.rateDims*', 'PrepShip dimension override fallback');
  const dimensionUnitsSource = stringOrNull(rawDimensions.units)
    ? sourceOf('v1', 'orders.raw.dimensions.units', 'ShipStation v1 /orders.dimensions.units')
    : sourceOf('derived', 'default dimensions.units', 'Defaulted to inches when ShipStation did not send units');
  const dimensions =
    dimensionLength != null && dimensionWidth != null && dimensionHeight != null
      ? {
          length: dimensionLength,
          width: dimensionWidth,
          height: dimensionHeight,
          units: stringOrNull(rawDimensions.units) ?? 'inches',
        }
      : null;
  const overrideWeightOz = finiteNumberOrNull(overrides?.rateWeightOz);
  const weightOz = overrideWeightOz ?? finiteNumberOrNull(order.weightOz);
  const orderId = finiteNumberOrNull(order.id);
  const clientId = finiteNumberOrNull(order.clientId);
  const storeId = finiteNumberOrNull(order.storeId);
  const sourceMap: Record<string, CanonicalFieldSource> = {
    id: sourceOf('local', 'orders.id', 'Postgres canonical order id'),
    orderId: sourceOf('local', 'orders.id', 'Postgres canonical order id'),
    externalOrderId: sourceOf('v1', 'orders.external_order_id', 'ShipStation v1 /orders.orderId'),
    orderNumber: sourceOf('v1', 'orders.order_number', 'ShipStation v1 /orders.orderNumber'),
    orderStatus: sourceOf('v1', 'orders.order_status', 'ShipStation v1 /orders.orderStatus'),
    orderDate: sourceOf('v1', 'orders.order_date', 'ShipStation v1 /orders.orderDate'),
    createdAt: sourceOf('local', 'orders.created_at', 'PrepShip order row create timestamp'),
    updatedAt: sourceOf('local', 'orders.updated_at', 'PrepShip order row update timestamp'),
    clientId: sourceOf('local', 'orders.client_id', 'PrepShip client/store mapping'),
    legacyClientId: sourceOf('derived', 'LEGACY_CLIENT_ID_BY_*', 'Derived from store/client id parity map'),
    storeId: sourceOf('v1', 'orders.store_id', 'ShipStation v1 /orders.advancedOptions.storeId'),
    'client.id': sourceOf('local', 'orders.client_id', 'PrepShip client/store mapping'),
    'client.legacyId': sourceOf('derived', 'LEGACY_CLIENT_ID_BY_*', 'Derived from store/client id parity map'),
    'client.storeId': sourceOf('v1', 'orders.store_id', 'ShipStation v1 /orders.advancedOptions.storeId'),
    'customer.email': sourceOf('v1', 'orders.customer_email', 'ShipStation v1 /orders.customerEmail'),
    'customer.username': sourceOf('v1', 'orders.raw.customerUsername', 'ShipStation v1 /orders.customerUsername'),
    'recipient.name': stringOrNull(rawShipTo.name)
      ? sourceOf('v1', 'orders.raw.shipTo.name', 'ShipStation v1 /orders.shipTo.name')
      : sourceOf('local', 'orders.ship_to_name', 'Synced fallback column from ShipStation v1 shipTo.name'),
    'recipient.company': sourceOf('v1', 'orders.raw.shipTo.company', 'ShipStation v1 /orders.shipTo.company'),
    'recipient.street1': sourceOf('v1', 'orders.raw.shipTo.street1', 'ShipStation v1 /orders.shipTo.street1'),
    'recipient.street2': sourceOf('v1', 'orders.raw.shipTo.street2', 'ShipStation v1 /orders.shipTo.street2'),
    'recipient.city': stringOrNull(rawShipTo.city)
      ? sourceOf('v1', 'orders.raw.shipTo.city', 'ShipStation v1 /orders.shipTo.city')
      : sourceOf('local', 'orders.ship_to_city', 'Synced fallback column from ShipStation v1 shipTo.city'),
    'recipient.state': stringOrNull(rawShipTo.state)
      ? sourceOf('v1', 'orders.raw.shipTo.state', 'ShipStation v1 /orders.shipTo.state')
      : sourceOf('local', 'orders.ship_to_state', 'Synced fallback column from ShipStation v1 shipTo.state'),
    'recipient.postalCode': stringOrNull(rawShipTo.postalCode)
      ? sourceOf('v1', 'orders.raw.shipTo.postalCode', 'ShipStation v1 /orders.shipTo.postalCode')
      : sourceOf('local', 'orders.ship_to_postal_code', 'Synced fallback column from ShipStation v1 shipTo.postalCode'),
    'recipient.country': stringOrNull(rawShipTo.country)
      ? sourceOf('v1', 'orders.raw.shipTo.country', 'ShipStation v1 /orders.shipTo.country')
      : sourceOf('derived', 'default recipient.country', 'Defaulted to US when ShipStation did not send a country'),
    'recipient.phone': sourceOf('v1', 'orders.raw.shipTo.phone', 'ShipStation v1 /orders.shipTo.phone'),
    'recipient.residential': overrides?.residential != null
      ? sourceOf('local', 'order_overrides.residential', 'PrepShip user override')
      : sourceOf('v1', 'orders.raw.shipTo.residential', 'ShipStation v1 /orders.shipTo.residential'),
    'recipient.addressVerified': sourceOf('v1', 'orders.raw.shipTo.addressVerified', 'ShipStation v1 /orders.shipTo.addressVerified'),
    weight: overrideWeightOz != null
      ? sourceOf('local', 'order_overrides.rateWeightOz', 'PrepShip weight override')
      : sourceOf('v1', 'orders.weight_oz', 'ShipStation v1 /orders.weight.value normalized to ounces'),
    weightOz: overrideWeightOz != null
      ? sourceOf('local', 'order_overrides.rateWeightOz', 'PrepShip weight override')
      : sourceOf('v1', 'orders.weight_oz', 'ShipStation v1 /orders.weight.value normalized to ounces'),
    'weight.value': overrideWeightOz != null
      ? sourceOf('local', 'order_overrides.rateWeightOz', 'PrepShip weight override')
      : sourceOf('v1', 'orders.weight_oz', 'ShipStation v1 /orders.weight.value normalized to ounces'),
    'weight.units': sourceOf('derived', 'canonical weight.units', 'Normalized to ounces for canonical rows'),
    dimensions: dimensionSource,
    'dimensions.length': dimensionSource,
    'dimensions.width': dimensionSource,
    'dimensions.height': dimensionSource,
    'dimensions.units': dimensionUnitsSource,
    packageCode: sourceOf('v1', 'orders.raw.packageCode', 'ShipStation v1 /orders.packageCode'),
    requestedShippingService: sourceOf('v1', 'orders.raw.requestedShippingService', 'ShipStation v1 /orders.requestedShippingService'),
    requestedServiceCode: stringOrNull(raw.serviceCode)
      ? sourceOf('v1', 'orders.raw.serviceCode', 'ShipStation v1 /orders.serviceCode')
      : sourceOf('local', 'orders.service_code', 'Synced fallback service column'),
    'totals.orderTotal': sourceOf('v1', 'orders.order_total', 'ShipStation v1 /orders.orderTotal'),
    'totals.shippingAmount': sourceOf('v1', 'orders.shipping_amount', 'ShipStation v1 /orders.shippingAmount'),
    items: sourceOf('v1', 'orders.items', 'ShipStation v1 /orders.items[]'),
    'flags.externallyShipped': sourceOf('local', 'orders.externally_shipped', 'PrepShip external-shipped override'),
    'flags.externallyFulfilled': sourceOf('v1', 'orders.raw.externallyFulfilled', 'ShipStation v1 /orders.externallyFulfilled'),
    'flags.externallyFulfilledVerified': sourceOf('local', 'orders.externally_fulfilled_verified', 'PrepShip verification flag'),
  };

  return {
    id: orderId,
    orderId,
    externalOrderId: stringOrNull(order.externalOrderId),
    orderNumber: stringOrNull(order.orderNumber),
    orderStatus: stringOrNull(order.orderStatus),
    orderDate: dateToIso(order.orderDate),
    createdAt: dateToIso(order.createdAt),
    updatedAt: dateToIso(order.updatedAt),
    clientId,
    legacyClientId,
    storeId,
    client: {
      id: clientId,
      legacyId: legacyClientId,
      storeId,
    },
    customer: {
      email: stringOrNull(order.customerEmail),
      username: stringOrNull(raw.customerUsername),
    },
    recipient: {
      name: stringOrNull(rawShipTo.name) ?? stringOrNull(order.shipToName),
      company: stringOrNull(rawShipTo.company),
      street1: stringOrNull(rawShipTo.street1),
      street2: stringOrNull(rawShipTo.street2),
      city: stringOrNull(rawShipTo.city) ?? stringOrNull(order.shipToCity),
      state: stringOrNull(rawShipTo.state) ?? stringOrNull(order.shipToState),
      postalCode: stringOrNull(rawShipTo.postalCode) ?? stringOrNull(order.shipToPostalCode),
      country: stringOrNull(rawShipTo.country) ?? 'US',
      phone: stringOrNull(rawShipTo.phone),
      residential: booleanOrNull(overrides?.residential) ?? booleanOrNull(rawShipTo.residential),
      addressVerified: stringOrNull(rawShipTo.addressVerified),
    },
    weight: weightOz != null ? { value: weightOz, units: 'ounces' } : null,
    weightOz,
    dimensions,
    packageCode: stringOrNull(raw.packageCode),
    requestedShippingService: stringOrNull(raw.requestedShippingService),
    requestedServiceCode: stringOrNull(raw.serviceCode) ?? stringOrNull(order.serviceCode),
    totals: {
      orderTotal: finiteNumberOrNull(order.orderTotal) ?? 0,
      shippingAmount: finiteNumberOrNull(order.shippingAmount) ?? 0,
    },
    items: Array.isArray(order.items) ? order.items : [],
    flags: {
      externallyShipped: Boolean(order.externallyShipped),
      externallyFulfilled: booleanOrNull(raw.externallyFulfilled),
      externallyFulfilledVerified: Boolean(order.externallyFulfilledVerified),
    },
    shipping,
    sourceMap: {
      ...sourceMap,
      ...recordOrNull(shipping.sourceMap),
    },
  };
}

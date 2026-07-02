import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { normalizeOrderSelectedRateDto } from './order-rate-dto';
import {
  WALMART_DIRECT_STORE_ID,
  WALMART_SHIPSTATION_STORE_ID,
  walmartDirectStoreDebugInfo,
} from '../lib/walmart-order-dedupe';
import {
  buildCanonicalOrderModel,
  normalizeListBestRate,
  pickNumberSource,
  pickStringSource,
  providerIdOrNull,
  rateAmount,
  recordOrNull,
  resolveLegacyClientId,
  resolveV2CarrierAccountRef,
  sourceOf,
  stringOrNull,
} from './order-canonical';

/**
 * Orders-list enrichment + row mapping (extracted verbatim from
 * routes/orders.ts). The route keeps scope/WHERE composition, pagination and
 * totals, the financials redaction pass, and all timing/log instrumentation.
 */

export type LatestShipmentRow = {
  order_id: number | null;
  order_number: string | null;
  tracking_number: string | null;
  carrier_code: string | null;
  service_code: string | null;
  ship_date: string | null;
  create_date: string | null;
  label_created_at: string | null;
  cost: string | null;
  label_cost: string | null;
  other_cost: string | null;
  label_url: string | null;
  label_shipment_id: number | null;
  provider_account_id: number | null;
  provider_account_nickname: string | null;
  selected_rate_json: Record<string, unknown> | null;
};

export type WalmartDirectDuplicate = {
  id: number;
  external_order_id: string | null;
  source_provider: string | null;
  source_account_id: string | null;
  order_status: string | null;
};

export const RATE_MONEY_FIELD_KEYS = new Set([
  'amount',
  'cost',
  'shipmentCost',
  'otherCost',
  'labelCost',
  'rawCost',
  'rateCost',
  'totalCost',
  'shippingCost',
  'shippingTotal',
  'standardShippingCost',
  'standardShippingTotal',
]);

export function redactRateMoneyFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactRateMoneyFields(item)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = RATE_MONEY_FIELD_KEYS.has(key)
      ? null
      : redactRateMoneyFields(nested);
  }
  return out as T;
}

export function redactOrderFinancials<T extends Record<string, unknown>>(row: T, canViewFinancials: boolean): T {
  if (canViewFinancials) return row;
  return {
    ...row,
    label: redactRateMoneyFields(row.label),
    selectedRate: redactRateMoneyFields(row.selectedRate),
    bestRate: redactRateMoneyFields(row.bestRate),
    shipping: redactRateMoneyFields(row.shipping),
    canonicalOrder: redactRateMoneyFields(row.canonicalOrder),
  };
}

type TimedStep = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export async function loadOrderListEnrichment(input: {
  pageOrderIds: number[];
  pageOrderNumbers: string[];
  walmartShipStationPageOrderNumbers: string[];
  /** true for the cancelled bucket, where voided shipments stay visible. */
  includeVoided: boolean;
  timed: TimedStep;
}) {
  const { pageOrderIds, pageOrderNumbers, walmartShipStationPageOrderNumbers, includeVoided, timed } = input;
  const latestShipByOrderId = new Map<number, LatestShipmentRow>();
  const latestShipByOrderNumber = new Map<string, LatestShipmentRow>();
  const walmartDirectDuplicateByOrderNumber = new Map<string, WalmartDirectDuplicate>();

  if (walmartShipStationPageOrderNumbers.length) {
    const directRows = await timed('walmartDirectDuplicates', () =>
      db.execute<{
        id: number;
        order_number: string;
        external_order_id: string | null;
        source_provider: string | null;
        source_account_id: string | null;
        order_status: string | null;
      }>(sql`
        select distinct on (order_number)
          id,
          order_number,
          external_order_id,
          source_provider,
          source_account_id,
          order_status
        from orders
        where store_id = ${WALMART_DIRECT_STORE_ID}
          and order_number in (${sql.join(walmartShipStationPageOrderNumbers.map((n) => sql`${n}`), sql`, `)})
        order by order_number, order_date desc nulls last, id desc
      `)
    );
    for (const row of directRows) {
      walmartDirectDuplicateByOrderNumber.set(row.order_number, row);
    }
  }
  if (pageOrderIds.length) {
    const shipRowsById = await timed('shipmentsByOrderId', () =>
      db.execute<LatestShipmentRow>(sql`
        select distinct on (order_id)
          order_id,
          order_number,
          tracking_number,
          carrier_code,
          service_code,
          ship_date,
          create_date,
          label_created_at,
          cost,
          label_cost,
          other_cost,
          label_url,
          label_shipment_id,
          provider_account_id,
          provider_account_nickname,
          selected_rate_json
        from shipments
        where order_id in (${sql.join(pageOrderIds.map((id) => sql`${id}`), sql`, `)})
          ${includeVoided ? sql`` : sql`and coalesce(voided, false) = false`}
        order by order_id, id desc
      `)
    );
    for (const s of shipRowsById) {
      if (s.order_id != null) {
        latestShipByOrderId.set(s.order_id, s);
      }
    }
  }
  if (pageOrderNumbers.length) {
    const shipRowsByOrderNumber = await timed('shipmentsByOrderNumber', () =>
      db.execute<LatestShipmentRow>(sql`
        select distinct on (order_number)
          order_id,
          order_number,
          tracking_number,
          carrier_code,
          service_code,
          ship_date,
          create_date,
          label_created_at,
          cost,
          label_cost,
          other_cost,
          label_url,
          label_shipment_id,
          provider_account_id,
          provider_account_nickname,
          selected_rate_json
        from shipments
        where order_id is null
          and order_number in (${sql.join(pageOrderNumbers.map((n) => sql`${n}`), sql`, `)})
          ${includeVoided ? sql`` : sql`and coalesce(voided, false) = false`}
        order by order_number, id desc
      `)
    );
    for (const s of shipRowsByOrderNumber) {
      if (s.order_number) {
        latestShipByOrderNumber.set(s.order_number, s);
      }
    }
  }

  return { latestShipByOrderId, latestShipByOrderNumber, walmartDirectDuplicateByOrderNumber };
}

export function mapOrderListRow<
  TOrder extends {
    id: number;
    clientId: number | null;
    storeId: number | null;
    orderNumber: string | null;
    orderStatus: string | null;
  },
  TOverrides extends { bestRateJson?: unknown } | null,
>(
  r: { order: TOrder; overrides: TOverrides },
  ctx: {
    statusFilter: string | undefined;
    canViewFinancials: boolean;
    latestShipByOrderId: Map<number, LatestShipmentRow>;
    latestShipByOrderNumber: Map<string, LatestShipmentRow>;
    walmartDirectDuplicateByOrderNumber: Map<string, WalmartDirectDuplicate>;
  },
) {
  const { statusFilter, canViewFinancials, latestShipByOrderId, latestShipByOrderNumber, walmartDirectDuplicateByOrderNumber } = ctx;
  const ship =
    latestShipByOrderId.get(r.order.id) ??
    (r.order.orderNumber != null ? latestShipByOrderNumber.get(r.order.orderNumber) : undefined);
  const legacyClientId = resolveLegacyClientId(r.order.clientId, r.order.storeId);
  const isShippedBucket = statusFilter === 'shipped' || r.order.orderStatus === 'shipped';
  const effectiveOrderStatus = isShippedBucket ? 'shipped' : r.order.orderStatus;
  const hasV2SelectedRateJson = Boolean(ship?.selected_rate_json);
  const selectedRateJsonRecord = recordOrNull(ship?.selected_rate_json);
  const selectedRateJsonProviderId = providerIdOrNull(
    selectedRateJsonRecord?.shippingProviderId ??
      selectedRateJsonRecord?.providerAccountId ??
      selectedRateJsonRecord?.carrier_id,
  );
  const selectedRateCarrierCode =
    stringOrNull(selectedRateJsonRecord?.carrierCode) ??
    stringOrNull(selectedRateJsonRecord?.carrier_code);
  const selectedRateServiceCode =
    stringOrNull(selectedRateJsonRecord?.serviceCode) ??
    stringOrNull(selectedRateJsonRecord?.service_code);
  const selectedRateCarrierNickname =
    stringOrNull(selectedRateJsonRecord?.providerAccountNickname) ??
    stringOrNull(selectedRateJsonRecord?.carrierNickname) ??
    stringOrNull(selectedRateJsonRecord?.carrier_nickname);
  const selectedRateServiceName =
    stringOrNull(selectedRateJsonRecord?.serviceName) ??
    stringOrNull(selectedRateJsonRecord?.service_type) ??
    selectedRateServiceCode;
  const resolvedCarrierAccount = ship
    ? resolveV2CarrierAccountRef(
        ship.provider_account_id,
        ship.carrier_code,
        ship.tracking_number,
        legacyClientId,
      )
    : null;
  const storedProviderAccountId = ship?.provider_account_id ?? null;
  const providerAccountId = storedProviderAccountId ?? resolvedCarrierAccount?.shippingProviderId ?? null;
  const providerAccountNickname = ship
    ? ship.provider_account_nickname ?? resolvedCarrierAccount?.nickname ?? null
    : null;
  const baseShipmentCost = ship?.cost != null ? Number(ship.cost) : null;
  const shipmentOtherCost = ship?.other_cost != null ? Number(ship.other_cost) : null;
  const rawLabelCost = ship?.label_cost != null ? Number(ship.label_cost) : null;
  const shipmentTotalCost = baseShipmentCost != null ? baseShipmentCost + (shipmentOtherCost ?? 0) : null;
  const labelCost = rawLabelCost ?? shipmentTotalCost;
  const selectedRateShipmentCost = baseShipmentCost ?? rawLabelCost;
  const selectedRateOtherCost =
    labelCost != null && baseShipmentCost != null
      ? Math.max(0, labelCost - baseShipmentCost)
      : shipmentOtherCost ?? 0;
  const labelCreatedFallback = ship?.label_created_at ?? ship?.create_date ?? ship?.ship_date ?? null;
  const label = ship
    ? {
        trackingNumber: ship.tracking_number,
        carrierCode: ship.carrier_code,
        serviceCode: ship.service_code,
        shipDate: ship.ship_date,
        createdAt: labelCreatedFallback,
        cost: labelCost,
        rawCost: baseShipmentCost,
        labelUrl: ship.label_url,
        shippingProviderId: providerAccountId,
        shipmentId: ship.label_shipment_id,
      }
    : null;
  const selectedRate =
    selectedRateJsonRecord
      ? {
          ...selectedRateJsonRecord,
          providerAccountId:
            selectedRateJsonRecord.providerAccountId ??
            selectedRateJsonProviderId ??
            providerAccountId,
          shippingProviderId:
            selectedRateJsonRecord.shippingProviderId ??
            selectedRateJsonProviderId ??
            providerAccountId,
          carrierCode: selectedRateCarrierCode,
          serviceCode: selectedRateServiceCode,
          serviceName: selectedRateServiceName,
          providerAccountNickname:
            selectedRateCarrierNickname ??
            providerAccountNickname ??
            null,
        }
      : ship
        ? normalizeOrderSelectedRateDto(
            {
              providerAccountId,
              providerAccountNickname,
              shippingProviderId: providerAccountId,
              carrierCode: ship.carrier_code,
              serviceCode: ship.service_code,
              serviceName: ship.service_code,
              cost: labelCost ?? selectedRateShipmentCost,
              shipmentCost: selectedRateShipmentCost,
              otherCost: selectedRateOtherCost,
            },
            undefined,
            `order ${r.order.id} shipment selectedRate`,
          )
      : null;
  const selectedRateBestRateCandidate =
    selectedRate && typeof selectedRate === 'object'
      ? {
          ...(selectedRate as Record<string, unknown>),
          carrierNickname:
            (selectedRate as Record<string, unknown>).carrierNickname ??
            (selectedRate as Record<string, unknown>).providerAccountNickname ??
            providerAccountNickname,
        }
      : null;
  const overrideBestRate =
    !isShippedBucket && r.overrides?.bestRateJson && typeof r.overrides.bestRateJson === 'object'
      ? {
          ...selectedRateBestRateCandidate,
          ...(r.overrides.bestRateJson as Record<string, unknown>),
          carrierNickname:
            (r.overrides.bestRateJson as Record<string, unknown>).carrierNickname ??
            selectedRateBestRateCandidate?.carrierNickname ??
            providerAccountNickname,
        }
      : null;
  const bestRate = !isShippedBucket ? normalizeListBestRate(overrideBestRate) : null;
  const walmartDirectDuplicate =
    r.order.storeId === WALMART_SHIPSTATION_STORE_ID && r.order.orderNumber != null
      ? walmartDirectDuplicateByOrderNumber.get(r.order.orderNumber)
      : undefined;
  const walmartSourceLink = walmartDirectDuplicate
    ? {
        provider: 'walmart',
        canonicalVisibleStoreId: WALMART_SHIPSTATION_STORE_ID,
        hiddenDuplicateStoreId: WALMART_DIRECT_STORE_ID,
        identity: r.order.orderNumber,
        hasShipStationSource: true,
        hasDirectWalmartSource: true,
        directDuplicateOrderId: walmartDirectDuplicate.id,
        directDuplicateExternalOrderId: walmartDirectDuplicate.external_order_id,
        directDuplicateStatus: walmartDirectDuplicate.order_status,
        directDuplicateSourceProvider: walmartDirectDuplicate.source_provider,
        directDuplicateSourceAccountId: walmartDirectDuplicate.source_account_id,
        mapping: walmartDirectStoreDebugInfo(),
      }
    : null;
  const bestRateRecord = recordOrNull(bestRate);
  const v2BestRateRecord = overrideBestRate ? bestRateRecord : null;
  const selectedRateRecord = recordOrNull(selectedRate);
  const carrierPick = pickStringSource([
    {
      value: hasV2SelectedRateJson ? selectedRateRecord?.carrierCode : null,
      source: sourceOf('v2', 'shipments.selected_rate_json.carrierCode', 'ShipStation v2 label/rate payload'),
    },
    {
      value: v2BestRateRecord?.carrierCode,
      source: sourceOf('v2', 'order_overrides.best_rate_json.carrierCode', 'ShipStation v2 /rates/estimate best rate'),
    },
    {
      value: ship?.carrier_code,
      source: sourceOf('v1', 'shipments.carrier_code', 'ShipStation v1 /shipments.carrierCode stored on linked shipment'),
    },
  ]);
  const servicePick = pickStringSource([
    {
      value: hasV2SelectedRateJson ? selectedRateRecord?.serviceCode : null,
      source: sourceOf('v2', 'shipments.selected_rate_json.serviceCode', 'ShipStation v2 label/rate payload'),
    },
    {
      value: v2BestRateRecord?.serviceCode,
      source: sourceOf('v2', 'order_overrides.best_rate_json.serviceCode', 'ShipStation v2 /rates/estimate best rate'),
    },
    {
      value: ship?.service_code,
      source: sourceOf('v1', 'shipments.service_code', 'ShipStation v1 /shipments.serviceCode stored on linked shipment'),
    },
  ]);
  const trackingPick = pickStringSource([
    {
      value: hasV2SelectedRateJson ? ship?.tracking_number : null,
      source: sourceOf('v2', 'shipments.tracking_number', 'ShipStation v2 /labels tracking_number stored on shipment'),
    },
    {
      value: ship?.tracking_number,
      source: sourceOf('v1', 'shipments.tracking_number', 'ShipStation v1 /shipments.trackingNumber stored on linked shipment'),
    },
  ]);
  const canonicalCarrierCode = carrierPick.value;
  const canonicalServiceCode = servicePick.value;
  const canonicalTrackingNumber = trackingPick.value;
  const providerPick = pickNumberSource([
    {
      value: hasV2SelectedRateJson ? selectedRateRecord?.shippingProviderId : null,
      source: sourceOf('v2', 'shipments.selected_rate_json.shippingProviderId', 'ShipStation v2 label/rate payload'),
    },
    {
      value: hasV2SelectedRateJson ? selectedRateRecord?.providerAccountId : null,
      source: sourceOf('v2', 'shipments.selected_rate_json.providerAccountId', 'ShipStation v2 label/rate payload'),
    },
    {
      value: storedProviderAccountId,
      source: sourceOf('v2', 'shipments.provider_account_id', 'ShipStation v2 /shipments or /labels carrier_id normalized from se-*'),
    },
    {
      value: resolvedCarrierAccount?.shippingProviderId,
      source: sourceOf('derived', 'V2_CARRIER_ACCOUNT_REFS', 'Derived from provider id, carrier code, tracking account number, and client id'),
    },
    {
      value: bestRateRecord?.shippingProviderId,
      source: sourceOf('v2', 'order_overrides.best_rate_json.shippingProviderId', 'ShipStation v2 /rates/estimate carrier_id normalized from se-*'),
    },
    {
      value: bestRateRecord?.providerAccountId,
      source: sourceOf('v2', 'order_overrides.best_rate_json.providerAccountId', 'ShipStation v2 /rates/estimate carrier_id normalized from se-*'),
    },
  ]);
  const canonicalProviderAccountId = providerPick.value;
  const resolvedCanonicalCarrierAccount = resolveV2CarrierAccountRef(
    canonicalProviderAccountId,
    canonicalCarrierCode,
    canonicalTrackingNumber,
    legacyClientId,
  );
  const accountPick = pickStringSource([
    {
      value: hasV2SelectedRateJson ? selectedRateRecord?.providerAccountNickname : null,
      source: sourceOf('v2', 'shipments.selected_rate_json.providerAccountNickname', 'ShipStation v2 label/rate payload'),
    },
    {
      value: providerAccountNickname,
      source: sourceOf('v2', 'shipments.provider_account_nickname', 'ShipStation v2 /carriers nickname cached on shipment'),
    },
    {
      value: bestRateRecord?.providerAccountNickname,
      source: sourceOf('v2', 'order_overrides.best_rate_json.providerAccountNickname', 'ShipStation v2 /rates/estimate account metadata'),
    },
    {
      value: bestRateRecord?.carrierNickname,
      source: sourceOf('v2', 'order_overrides.best_rate_json.carrierNickname', 'ShipStation v2 /rates/estimate account metadata'),
    },
    {
      value: resolvedCanonicalCarrierAccount?.nickname,
      source: sourceOf('derived', 'V2_CARRIER_ACCOUNT_REFS', 'Derived from provider id, carrier code, tracking account number, and client id'),
    },
  ]);
  const canonicalAccountNickname = accountPick.value;
  const selectedRateFromJsonAmount = hasV2SelectedRateJson ? rateAmount(selectedRate) : null;
  const selectedRateFromV2BestRateAmount = overrideBestRate ? rateAmount(bestRate) : null;
  const selectedRatePick = pickNumberSource([
    {
      value: selectedRateFromJsonAmount,
      source: sourceOf('v2', 'shipments.selected_rate_json', 'ShipStation v2 selected label/rate payload'),
    },
    {
      value: !isShippedBucket ? selectedRateFromV2BestRateAmount : null,
      source: sourceOf('v2', 'order_overrides.best_rate_json', 'ShipStation v2 /rates/estimate best rate'),
    },
    {
      value: rawLabelCost,
      source: sourceOf('v2', 'shipments.label_cost', 'ShipStation v2 /labels shipment_cost stored from label purchase/sync'),
    },
    {
      value: shipmentTotalCost,
      source: sourceOf('v1', 'shipments.cost + shipments.other_cost', 'ShipStation v1 /shipments shipmentCost + otherCost stored on linked shipment'),
    },
  ]);
  const selectedRateAmount = selectedRatePick.value;
  const bestRatePick = isShippedBucket
    ? {
        value: null,
        source: sourceOf('local', 'null', 'Shipped rows intentionally do not expose awaiting best-rate data'),
      }
    : pickNumberSource([
        {
          value: rateAmount(bestRate),
          source: overrideBestRate
            ? sourceOf('v2', 'order_overrides.best_rate_json', 'ShipStation v2 /rates/estimate best rate')
            : sourceOf('local', 'null', 'No v2 best-rate JSON present'),
        },
      ]);
  const labelCreatedPick = [
    {
      value: ship?.label_created_at,
      source: sourceOf('v2', 'shipments.label_created_at', 'ShipStation v2 label creation timestamp stored on shipment'),
    },
    {
      value: ship?.create_date,
      source: sourceOf('v1', 'shipments.create_date', 'ShipStation v1 /shipments.createDate stored on linked shipment'),
    },
    {
      value: ship?.ship_date,
      source: sourceOf('v1', 'shipments.ship_date', 'ShipStation v1 /shipments.shipDate stored on linked shipment'),
    },
  ].find((candidate) => candidate.value != null) ?? {
    value: null,
    source: sourceOf('local', 'null', 'no populated source field'),
  };
  const labelCreatedAt =
    labelCreatedPick.value ??
    null;
  const labelCostPick = pickNumberSource([
    {
      value: rawLabelCost,
      source: sourceOf('v2', 'shipments.label_cost', 'ShipStation v2 /labels shipment_cost stored from label purchase/sync'),
    },
    {
      value: shipmentTotalCost,
      source: sourceOf('v1', 'shipments.cost + shipments.other_cost', 'ShipStation v1 /shipments shipmentCost + otherCost stored on linked shipment'),
    },
  ]);
  const shipping = {
    carrierCode: canonicalCarrierCode,
    serviceCode: canonicalServiceCode,
    trackingNumber: canonicalTrackingNumber,
    providerAccountId: canonicalProviderAccountId,
    accountNickname: canonicalAccountNickname,
    selectedRateAmount: canViewFinancials ? selectedRateAmount : null,
    bestRateAmount: canViewFinancials ? bestRatePick.value : null,
    labelCost: canViewFinancials ? labelCost : null,
    labelCreatedAt,
    shipDate: ship?.ship_date ?? null,
    shipmentId: ship?.label_shipment_id ?? null,
    source: ship ? 'shipment' : overrideBestRate ? 'order_override' : null,
    selectedRate: canViewFinancials ? selectedRate : redactRateMoneyFields(selectedRate),
    bestRate: canViewFinancials ? bestRate : redactRateMoneyFields(bestRate),
    sourceMap: {
      'shipping.carrierCode': carrierPick.source,
      'shipping.serviceCode': servicePick.source,
      'shipping.trackingNumber': trackingPick.source,
      'shipping.providerAccountId': providerPick.source,
      'shipping.accountNickname': accountPick.source,
      'shipping.selectedRateAmount': selectedRatePick.source,
      'shipping.bestRateAmount': bestRatePick.source,
      'shipping.labelCost': labelCostPick.source,
      'shipping.labelCreatedAt': labelCreatedPick.source,
      'shipping.shipDate': ship?.ship_date != null
        ? sourceOf('v1', 'shipments.ship_date', 'ShipStation v1 /shipments.shipDate')
        : sourceOf('local', 'null', 'no populated source field'),
      'shipping.shipmentId': ship?.label_shipment_id != null
        ? sourceOf('v1', 'shipments.label_shipment_id', 'ShipStation v1 /shipments.shipmentId')
        : sourceOf('local', 'null', 'no populated source field'),
      'shipping.source': ship
        ? sourceOf('local', 'shipments row', 'Canonical shipping model was built from the linked PrepShip shipment row')
        : overrideBestRate
          ? sourceOf('local', 'order_overrides.best_rate_json', 'Canonical shipping model was built from saved rate override data')
          : sourceOf('local', 'null', 'no populated source field'),
      'shipping.selectedRate': hasV2SelectedRateJson
        ? sourceOf('v2', 'shipments.selected_rate_json', 'ShipStation v2 selected label/rate payload')
        : ship
          ? sourceOf('v1', 'shipments row', 'Selected-rate display was built from linked ShipStation shipment fields')
          : sourceOf('local', 'null', 'No selected-rate JSON or linked shipment row present'),
      'shipping.bestRate': overrideBestRate
        ? sourceOf('v2', 'order_overrides.best_rate_json', 'ShipStation v2 /rates/estimate best rate')
        : sourceOf('local', 'null', isShippedBucket ? 'Shipped rows intentionally do not expose awaiting best-rate data' : 'No v2 best-rate JSON present'),
    },
  };
  const orderForCanonical = {
    ...(r.order as unknown as Record<string, unknown>),
    orderStatus: effectiveOrderStatus,
  };
  const canonicalOrder = buildCanonicalOrderModel(
    orderForCanonical,
    r.overrides as unknown as Record<string, unknown> | null,
    legacyClientId,
    shipping,
  );
  return {
    ...r.order,
    orderStatus: effectiveOrderStatus,
    legacyClientId,
    overrides: r.overrides,
    label: label
      ? {
          ...label,
          cost: canViewFinancials ? labelCost : null,
          rawCost: canViewFinancials ? baseShipmentCost : null,
        }
      : null,
    selectedRate: canViewFinancials ? selectedRate : redactRateMoneyFields(selectedRate),
    bestRate: canViewFinancials ? bestRate : redactRateMoneyFields(bestRate),
    shipping,
    canonicalOrder,
    sourceLink: walmartSourceLink,
  };
}

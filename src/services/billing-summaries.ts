// Billing summary + invoice-detail read models - extracted from
// services/billing.ts (C4 decomposition). Billing writes stay in billing.ts;
// customer shipping money is frozen by PrepShip and only consumed here.
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { billingLineItems } from '../db/schema/billing';
import { shipments } from '../db/schema/shipments';
import { orderOverrides, orders } from '../db/schema/orders';
import { packages } from '../db/schema/packages';
import { clients } from '../db/schema/clients';
import { resolveCarrierNickname } from './labels';
import {
  getFreshBillingSummaryMetrics,
  refreshBillingSummaryMetrics,
} from './reporting-metrics';
import {
  billingClientScopePredicate,
  billingLineItemScopePredicate,
  dimsKey,
  dimsLabel,
  itemSummary,
  providerAccountIdOrNull,
  stringOrNull,
  toFiniteNumber,
  toNum,
  type GenerateInput,
} from './billing-read-support';
import {
  BILLING_POLICY_WEEKEND_ROLLFORWARD,
  billingLineEffectiveDaySql,
} from './billing-effective-day';
import { customerSafeBillingLineSql } from '../lib/client-portal/customer-shipping-rate';

const persistedBillingEffectiveDay = billingLineEffectiveDaySql(
  billingLineItems.billingEffectiveDate,
  billingLineItems.shipDate,
);

const customerSafeSummaryLine = customerSafeBillingLineSql({
  lineType: sql`b.line_type`,
  shipmentId: sql`b.shipment_id`,
  totalCost: sql`b.total_cost`,
});

const customerSafeUnaliasedSummaryLine = customerSafeBillingLineSql({
  lineType: sql`line_type`,
  shipmentId: sql`shipment_id`,
  totalCost: sql`total_cost`,
});

function billingSummaryHasValues(summary: { clients: BillingSummaryRow[] }): boolean {
  return summary.clients.some(
    (row) =>
      row.orderCount > 0 ||
      row.pickPackTotal > 0 ||
      row.additionalTotal > 0 ||
      row.packageTotal > 0 ||
      row.shippingTotal > 0 ||
      row.storageTotal > 0 ||
      row.returnPostageTotal > 0 ||
      row.returnProcessingTotal > 0 ||
      row.grandTotal > 0
  );
}

export type BillingSummaryRow = {
  clientId: number;
  clientName: string;
  pickPackTotal: number;
  additionalTotal: number;
  packageTotal: number;
  shippingTotal: number;
  storageTotal: number;
  // CP-031: return billing totals (surface in byType + fold into grandTotal).
  returnPostageTotal: number;
  /** PS-512 — categories that were inside grand_total but invisible on every itemized surface. */
  adjustmentTotal: number;
  replacePostageTotal: number;
  replacePickPackTotal: number;
  returnProcessingTotal: number;
  orderCount: number;
  grandTotal: number;
  // Back-compat fields for legacy callers of the old shape.
  total: number;
  count: number;
  byType: Record<string, number>;
};

async function hasBillingLineItemsForSummary(input: GenerateInput): Promise<boolean> {
  const [row] = await db.execute<{ exists: boolean }>(sql`
    select exists (
      select 1
      from billing_line_items
      where coalesce(billing_effective_date, ship_date) >= ${input.dateFrom}::timestamptz
        and coalesce(billing_effective_date, ship_date) < ${input.dateTo}::timestamptz
        and ${customerSafeUnaliasedSummaryLine}
        ${input.clientId !== undefined ? sql`and client_id = ${input.clientId}` : sql``}
        and ${billingLineItemScopePredicate(input)}
      limit 1
    ) as exists
  `);
  return row?.exists === true;
}

export async function billingSummary(
  input: GenerateInput
): Promise<{ clients: BillingSummaryRow[]; grandTotal: number }> {
  let hasGeneratedRows: boolean | null = null;
  const hasLineItems = async () => {
    if (hasGeneratedRows === null) {
      hasGeneratedRows = await hasBillingLineItemsForSummary(input);
    }
    return hasGeneratedRows;
  };

  const metrics = await getFreshBillingSummaryMetrics({
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    clientId: input.clientId,
    scopeClientIds: input.scopeClientIds,
    scopeStoreIds: input.scopeStoreIds,
    scopeRestricted: input.scopeRestricted,
    maxAgeMinutes: 45,
  }).catch((err) => {
    console.warn(
      '[billing] summary reporting metrics unavailable:',
      err instanceof Error ? err.message : err
    );
    return null;
  });
  if (metrics && billingSummaryHasValues(metrics)) return metrics;

  if (metrics && !(await hasLineItems())) return metrics;

  if (!metrics || !billingSummaryHasValues(metrics)) {
    if (await hasLineItems()) {
      try {
        console.info('[billing] refreshing stale or incomplete summary metrics from billing_line_items', {
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          clientId: input.clientId ?? null,
        });
        await refreshBillingSummaryMetrics(
          new Date(input.dateFrom),
          new Date(input.dateTo)
        );
        const refreshedMetrics = await getFreshBillingSummaryMetrics({
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          clientId: input.clientId,
          scopeClientIds: input.scopeClientIds,
          scopeStoreIds: input.scopeStoreIds,
          scopeRestricted: input.scopeRestricted,
          maxAgeMinutes: 45,
        });
        if (refreshedMetrics) return refreshedMetrics;
      } catch (err) {
        console.warn(
          '[billing] failed to refresh stale summary metrics:',
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  const useLiveFallback =
    process.env.BILLING_SUMMARY_LIVE_FALLBACK === 'true' || (await hasLineItems());
  if (!useLiveFallback) {
    const clientRows = await db.execute<{
      client_id: number;
      client_name: string;
    }>(sql`
      select
        c.id as client_id,
        c.name as client_name
      from clients c
      where c.active = true
        and c.name not in ('Manual Orders', 'Rate Browser', 'Api Shipments')
        ${input.clientId !== undefined ? sql`and c.id = ${input.clientId}` : sql``}
        and ${billingClientScopePredicate(input)}
      order by c.name asc
    `);

    return {
      clients: clientRows.map((row) => ({
        clientId: row.client_id,
        clientName: row.client_name,
        pickPackTotal: 0,
        additionalTotal: 0,
        packageTotal: 0,
        shippingTotal: 0,
        storageTotal: 0,
        returnPostageTotal: 0,
        adjustmentTotal: 0,
        replacePostageTotal: 0,
        replacePickPackTotal: 0,
        returnProcessingTotal: 0,
        orderCount: 0,
        grandTotal: 0,
        total: 0,
        count: 0,
        byType: {
          pick_pack: 0,
          additional_unit: 0,
          package_cost: 0,
          shipping: 0,
          storage: 0,
          return_postage: 0,
          return_processing_fee: 0,
        },
      })),
      grandTotal: 0,
    };
  }

  // v2-parity aggregation. Starts from `clients` with a LEFT JOIN to
  // billing_line_items so every active, non-system client surfaces — even
  // those with zero volume in the window (HUGRAB, KimlyParc, IntegrationTest,
  // the TEST_* sandboxes). The previous version aggregated from
  // billing_line_items alone, dropping zero-volume clients entirely and
  // causing the Summary grid to look half-empty vs. v2.
  //
  // Totals are filtered SUMs per line_type; orderCount counts distinct billed
  // orders from any order-backed line so clients with $0 pick/pack defaults
  // still show order volume when shipping lines were generated.
  const rows = await db.execute<{
    client_id: number;
    client_name: string;
    pickpack_total: string;
    additional_total: string;
    package_total: string;
    shipping_total: string;
    storage_total: string;
    return_postage_total: string;
    adjustment_total: string;
    replace_postage_total: string;
    replace_pick_pack_total: string;
    return_processing_total: string;
    order_count: number;
    grand_total: string;
  }>(sql`
    select
      c.id as client_id,
      c.name as client_name,
      coalesce(sum(case when b.line_type = 'pick_pack' then b.total_cost else 0 end), 0)::text as pickpack_total,
      coalesce(sum(case when b.line_type = 'additional_unit' then b.total_cost else 0 end), 0)::text as additional_total,
      coalesce(sum(case when b.line_type = 'package_cost' then b.total_cost else 0 end), 0)::text as package_total,
      coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)::text as shipping_total,
      coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end), 0)::text as storage_total,
      -- CP-031: return line types fold into byType here; grand_total (sum of ALL
      -- line types) already reconciles them into the grand total.
      coalesce(sum(case when b.line_type = 'return_postage' then b.total_cost else 0 end), 0)::text as return_postage_total,
      coalesce(sum(case when b.line_type = 'return_processing_fee' then b.total_cost else 0 end), 0)::text as return_processing_total,
      -- PS-512: adjustment and REPLACEMENT money were already inside grand_total (it sums every
      -- line type) but had no category of their own, so an itemized invoice showed components
      -- that did not add up to its own total. Broken out here, at the summary authority, rather
      -- than derived in a serializer — same pattern CP-031 used for the return categories.
      coalesce(sum(case when b.line_type = 'billing_adjustment' then b.total_cost else 0 end), 0)::text as adjustment_total,
      coalesce(sum(case when b.line_type = 'replace_postage' then b.total_cost else 0 end), 0)::text as replace_postage_total,
      coalesce(sum(case when b.line_type = 'replace_pick_pack' then b.total_cost else 0 end), 0)::text as replace_pick_pack_total,
      count(distinct b.order_id)::int as order_count,
      coalesce(sum(b.total_cost), 0)::text as grand_total
    from clients c
    left join billing_line_items b
      on b.client_id = c.id
      and coalesce(b.billing_effective_date, b.ship_date) >= ${input.dateFrom}::timestamptz
      and coalesce(b.billing_effective_date, b.ship_date) < ${input.dateTo}::timestamptz
      and ${customerSafeSummaryLine}
    where c.active = true
      and c.name not in ('Manual Orders', 'Rate Browser', 'Api Shipments')
      ${input.clientId !== undefined ? sql`and c.id = ${input.clientId}` : sql``}
      and ${billingClientScopePredicate(input)}
    group by c.id, c.name
    order by c.name asc
  `);

  const clientsOut: BillingSummaryRow[] = rows.map((r) => {
    const pickPackTotal = toNum(r.pickpack_total);
    const additionalTotal = toNum(r.additional_total);
    const packageTotal = toNum(r.package_total);
    const shippingTotal = toNum(r.shipping_total);
    const storageTotal = toNum(r.storage_total);
    const returnPostageTotal = toNum(r.return_postage_total);
    const adjustmentTotal = toNum(r.adjustment_total);
    const replacePostageTotal = toNum(r.replace_postage_total);
    const replacePickPackTotal = toNum(r.replace_pick_pack_total);
    const returnProcessingTotal = toNum(r.return_processing_total);
    const grandTotal = toNum(r.grand_total);
    return {
      clientId: r.client_id,
      clientName: r.client_name,
      pickPackTotal,
      additionalTotal,
      packageTotal,
      shippingTotal,
      storageTotal,
      returnPostageTotal,
      adjustmentTotal,
      replacePostageTotal,
      replacePickPackTotal,
      returnProcessingTotal,
      orderCount: Number(r.order_count ?? 0),
      grandTotal,
      total: grandTotal,
      count: Number(r.order_count ?? 0),
      byType: {
        pick_pack: pickPackTotal,
        additional_unit: additionalTotal,
        package_cost: packageTotal,
        shipping: shippingTotal,
        storage: storageTotal,
        return_postage: returnPostageTotal,
        return_processing_fee: returnProcessingTotal,
      },
    };
  });

  return {
    clients: clientsOut,
    grandTotal: clientsOut.reduce((sum, c) => sum + c.grandTotal, 0),
  };
}

export async function billingDetails(input: GenerateInput & { limit?: number }) {
  const from = new Date(input.dateFrom);
  const to = new Date(input.dateTo);
  const rows = await db
    .select({
      id: billingLineItems.id,
      clientId: billingLineItems.clientId,
      orderId: billingLineItems.orderId,
      orderNumber: billingLineItems.orderNumber,
      shipmentId: billingLineItems.shipmentId,
      shipDate: billingLineItems.shipDate,
      billingEffectiveDate: billingLineItems.billingEffectiveDate,
      billingPolicyVersion: billingLineItems.billingPolicyVersion,
      lineType: billingLineItems.lineType,
      description: billingLineItems.description,
      qty: billingLineItems.qty,
      unitCost: billingLineItems.unitCost,
      totalCost: billingLineItems.totalCost,
      invoiced: billingLineItems.invoiced,
      createdAt: billingLineItems.createdAt,
      carrierCode: shipments.carrierCode,
      providerAccountId: shipments.providerAccountId,
      labelProvider: shipments.labelProvider,
      trackingNumber: shipments.trackingNumber,
      providerAccountNickname: shipments.providerAccountNickname,
      selectedRateJson: shipments.selectedRateJson,
      selectedPackageId: shipments.selectedPackageId,
      selectedPid: shipments.selectedPid,
      dimsL: shipments.dimsL,
      dimsW: shipments.dimsW,
      dimsH: shipments.dimsH,
      labelCost: shipments.labelCost,
      cost: shipments.cost,
      otherCost: shipments.otherCost,
      orderItems: orders.items,
      refUspsRate: orderOverrides.refUspsRate,
      refUpsRate: orderOverrides.refUpsRate,
    })
    .from(billingLineItems)
    .leftJoin(shipments, eq(billingLineItems.shipmentId, shipments.id))
    .leftJoin(orders, eq(billingLineItems.orderId, orders.id))
    .leftJoin(orderOverrides, eq(billingLineItems.orderId, orderOverrides.orderId))
    .where(
      and(
        gte(persistedBillingEffectiveDay, from),
        lt(persistedBillingEffectiveDay, to),
        input.clientId !== undefined
          ? eq(billingLineItems.clientId, input.clientId)
          : undefined,
        billingLineItemScopePredicate(input)
      )
    )
    .orderBy(persistedBillingEffectiveDay)
    .limit(input.limit ?? 500);

  const packageRows = await db
    .select({
      id: packages.id,
      name: packages.name,
      packageCode: packages.packageCode,
      length: packages.length,
      width: packages.width,
      height: packages.height,
    })
    .from(packages);
  const packagesById = new Map(packageRows.map((pkg) => [pkg.id, pkg]));
  const packagesByCode = new Map(
    packageRows
      .filter((pkg) => pkg.packageCode)
      .map((pkg) => [pkg.packageCode!, pkg])
  );
  const packagesByDims = new Map(
    packageRows
      .map((pkg) => [dimsKey(pkg.length, pkg.width, pkg.height), pkg] as const)
      .filter((entry): entry is [string, (typeof packageRows)[number]] => Boolean(entry[0]))
  );
  const nicknameCache = new Map<string, Promise<string | null>>();

  return Promise.all(
    rows.map(async (row) => {
      const selectedRate =
        row.selectedRateJson && typeof row.selectedRateJson === 'object'
          ? (row.selectedRateJson as Record<string, unknown>)
          : null;

      const providerAccountId =
        row.providerAccountId ??
        row.labelProvider ??
        providerAccountIdOrNull(
          selectedRate?.providerAccountId ??
            selectedRate?.shippingProviderId ??
            selectedRate?.carrier_id
        );
      const carrierCode =
        row.carrierCode ??
        stringOrNull(selectedRate?.carrierCode ?? selectedRate?.carrier_code);
      const storedNickname =
        row.providerAccountNickname ??
        stringOrNull(
          selectedRate?.providerAccountNickname ??
            selectedRate?.carrierNickname ??
            selectedRate?.carrier_nickname
        );

      let carrierNickname = storedNickname;
      if (!carrierNickname && carrierCode) {
        const cacheKey = `${providerAccountId ?? 'none'}:${carrierCode}`;
        let pending = nicknameCache.get(cacheKey);
        if (!pending) {
          pending = resolveCarrierNickname(
            providerAccountId ?? null,
            carrierCode,
            row.trackingNumber,
            row.clientId
          );
          nicknameCache.set(cacheKey, pending);
        }
        carrierNickname = await pending;
      }

      const items = itemSummary(row.orderItems);
      const lineType = row.lineType ?? '';
      const isShippingLine = lineType === 'shipping';
      const labelCost =
        toFiniteNumber(row.labelCost) ??
        (() => {
          const cost = toFiniteNumber(row.cost);
          if (cost == null) return null;
          return cost + (toFiniteNumber(row.otherCost) ?? 0);
        })();
      const refUspsRate = toFiniteNumber(row.refUspsRate);
      const refUpsRate = toFiniteNumber(row.refUpsRate);
      const selectedPackageNumericId = providerAccountIdOrNull(row.selectedPackageId);
      const selectedPackage =
        (row.selectedPid != null ? packagesById.get(row.selectedPid) : undefined) ??
        (selectedPackageNumericId != null ? packagesById.get(selectedPackageNumericId) : undefined) ??
        (row.selectedPackageId ? packagesByCode.get(row.selectedPackageId) : undefined) ??
        (dimsKey(row.dimsL, row.dimsW, row.dimsH)
          ? packagesByDims.get(dimsKey(row.dimsL, row.dimsW, row.dimsH)!)
          : undefined);
      const packageName =
        selectedPackage?.name ??
        row.description.match(/^Box\s+\((.+)\)$/i)?.[1] ??
        dimsLabel(row.dimsL, row.dimsW, row.dimsH);

      const {
        selectedRateJson: _selectedRateJson,
        labelProvider: _labelProvider,
        orderItems: _orderItems,
        labelCost: _labelCost,
        cost: _cost,
        otherCost: _otherCost,
        selectedPackageId: _selectedPackageId,
        selectedPid: _selectedPid,
        dimsL: _dimsL,
        dimsW: _dimsW,
        dimsH: _dimsH,
        refUspsRate: _refUspsRate,
        refUpsRate: _refUpsRate,
        ...rest
      } = row;
      return {
        ...rest,
        actualActivityDate: row.shipDate,
        billingEffectiveDate: row.billingEffectiveDate ?? row.shipDate,
        rolledFromWeekend:
          row.billingPolicyVersion === BILLING_POLICY_WEEKEND_ROLLFORWARD &&
          row.shipDate != null &&
          row.billingEffectiveDate != null &&
          row.shipDate.getTime() !== row.billingEffectiveDate.getTime(),
        carrierCode,
        providerAccountId,
        providerAccountNickname: carrierNickname,
        carrierNickname: carrierNickname ?? carrierCode,
        itemNames: items.itemNames,
        itemSkus: items.itemSkus,
        totalQty: items.totalQty,
        packageName,
        actualLabelCost: isShippingLine ? labelCost : null,
        actual_label_cost: isShippingLine ? labelCost : null,
        refUspsRate: isShippingLine ? refUspsRate : null,
        ref_usps_rate: isShippingLine ? refUspsRate : null,
        refUpsRate: isShippingLine ? refUpsRate : null,
        ref_ups_rate: isShippingLine ? refUpsRate : null,
      };
    })
  );
}

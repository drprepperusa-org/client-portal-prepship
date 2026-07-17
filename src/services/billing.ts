import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { billingLineItems, clientPackagePrices } from '../db/schema/billing';
import { shipments } from '../db/schema/shipments';
import { orderOverrides, orders } from '../db/schema/orders';
import { packages } from '../db/schema/packages';
import { clients } from '../db/schema/clients';
import { inventory } from '../db/schema/inventory';
import { returns } from '../db/schema/returns';
import { readFrozenCustomerShippingMoney } from '../lib/customer-shipping-money-snapshot';
import { resolveReturnReference } from './return-reference';
import { refreshBillingSummaryMetrics } from './reporting-metrics';

export type GenerateInput = {
  clientId?: number;
  // Client-portal billing routes pass UTC-midnight calendar-day bounds from
  // billingDayRange. dateFrom is inclusive; dateTo is EXCLUSIVE day-after
  // midnight. Every ship_date comparison in this file must use
  // `>= dateFrom AND < dateTo`.
  dateFrom: string; // ISO, UTC midnight, inclusive
  dateTo: string; // ISO, UTC midnight, EXCLUSIVE
  scopeClientIds?: number[];
  scopeStoreIds?: number[];
  scopeRestricted?: boolean;
};

// v2 parity constant: the first unit on every order is included in the pick/pack
// fee; every subsequent unit is billed at additionalUnitFee. v2 hardcodes this
// to 1 (see apps/api/src/modules/billing/data/sqlite-billing-repository.ts:216).
// If a configurable per-client cap is needed later, add a pick_pack_max_units
// column to billing_config and read it here.
// Fallback when a client's billing_config row has no pickPackMaxUnits set
// (legacy rows or newly-created clients). Matches v2's hardcoded constant.
const PICK_PACK_MAX_UNITS_DEFAULT = 1;

export function toNum(v: string | null | undefined) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeScopeIds(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function intArraySql(values: number[]): SQL {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::int[]`;
}

export function billingClientScopePredicate(input: GenerateInput): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(input.scopeClientIds);
  const storeIds = normalizeScopeIds(input.scopeStoreIds);

  if (clientIds.length) {
    predicates.push(sql`c.id = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`c.store_ids && ${intArraySql(storeIds)}`);
  }
  if (!predicates.length) {
    return input.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export function billingLineItemScopePredicate(input: GenerateInput): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(input.scopeClientIds);
  const storeIds = normalizeScopeIds(input.scopeStoreIds);

  if (clientIds.length) {
    predicates.push(sql`${billingLineItems.clientId} = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`exists (
      select 1 from clients scoped_client
      where scoped_client.id = ${billingLineItems.clientId}
        and scoped_client.store_ids && ${intArraySql(storeIds)}
    )`);
  }
  if (!predicates.length) {
    return input.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

// CP-019: order-level tenant scope for generateLineItems' source query — an
// order is in scope when its client is in scope (by clientId or the client's
// assigned stores). Mirrors billingLineItemScopePredicate but over orders.
export function billingOrderScopePredicate(input: GenerateInput): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(input.scopeClientIds);
  const storeIds = normalizeScopeIds(input.scopeStoreIds);

  if (clientIds.length) {
    predicates.push(sql`${orders.clientId} = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`exists (
      select 1 from clients scoped_client
      where scoped_client.id = ${orders.clientId}
        and scoped_client.store_ids && ${intArraySql(storeIds)}
    )`);
  }
  if (!predicates.length) {
    return input.scopeRestricted === true ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function itemSkuOrFallback(record: Record<string, unknown>): string | null {
  const sku =
    stringOrNull(record.sku) ??
    stringOrNull(record.fulfillmentSku) ??
    stringOrNull(record.warehouseLocation);
  if (sku) return sku;

  const productId = toFiniteNumber(record.productId);
  return productId != null ? String(Math.trunc(productId)) : null;
}

export function providerAccountIdOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized =
    typeof value === 'string' ? value.replace(/^se-/i, '') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function itemSummary(items: unknown) {
  if (!Array.isArray(items)) {
    return { itemNames: null, itemSkus: null, totalQty: null };
  }

  const names: string[] = [];
  const skus: string[] = [];
  let totalQty = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.adjustment === true) continue;

    const name = stringOrNull(record.name);
    const sku = itemSkuOrFallback(record);
    const qty = toFiniteNumber(record.quantity) ?? 1;

    if (name) names.push(name);
    if (sku) skus.push(sku);
    if (qty > 0) totalQty += qty;
  }

  return {
    itemNames: names.length ? [...new Set(names)].join(' | ') : null,
    itemSkus: skus.length ? [...new Set(skus)].join(' | ') : null,
    totalQty: totalQty > 0 ? totalQty : null,
  };
}

export function dimsKey(length: unknown, width: unknown, height: unknown) {
  const l = toFiniteNumber(length);
  const w = toFiniteNumber(width);
  const h = toFiniteNumber(height);
  if (l == null || w == null || h == null || l <= 0 || w <= 0 || h <= 0) {
    return null;
  }
  return `${l}x${w}x${h}`;
}

export function dimsLabel(length: unknown, width: unknown, height: unknown) {
  const key = dimsKey(length, width, height);
  return key ? `${key} in` : null;
}

// Sum the billable units on an order. Mirrors v2's logic:
//   - Filter out items flagged as `adjustment: true` (refunds, price tweaks)
//   - Default missing `quantity` to 1 (v2 line 192 / pick-list default)
function totalUnitsFromItems(items: unknown[] | null | undefined): number {
  if (!Array.isArray(items)) return 0;
  let n = 0;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if ((it as { adjustment?: unknown }).adjustment === true) continue;
    const qRaw = (it as { quantity?: unknown }).quantity;
    const q = qRaw == null ? 1 : Number(qRaw);
    if (Number.isFinite(q) && q > 0) n += q;
  }
  return n;
}

export async function generateLineItems(input: GenerateInput) {
  const from = new Date(input.dateFrom);
  const to = new Date(input.dateTo);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Match /billing/config: active clients without a billing_config row still
  // generate with defaults, otherwise a fresh install has visible clients but
  // "Generate Invoices" finds no configs and produces an empty summary.
  const configs = await db.execute<{
    clientId: number;
    pickPackFee: string;
    pickPackMaxUnits: number;
    additionalUnitFee: string;
    packageCostMarkup: string;
    // Processing fee remains independent; all postage pricing fields are retired.
    returnProcessingFee: string;
    storageFeePerCuFt: string;
    active: boolean;
  }>(sql`
    select
      c.id as "clientId",
      coalesce(b.pick_pack_fee, '0'::numeric)::text as "pickPackFee",
      coalesce(b.pick_pack_max_units, 1)::int as "pickPackMaxUnits",
      coalesce(b.additional_unit_fee, '0'::numeric)::text as "additionalUnitFee",
      coalesce(b.package_cost_markup, '0'::numeric)::text as "packageCostMarkup",
      coalesce(b.return_processing_fee, '0'::numeric)::text as "returnProcessingFee",
      coalesce(b.storage_fee_per_cu_ft, '0'::numeric)::text as "storageFeePerCuFt",
      coalesce(b.active, true) as active
    from clients c
    left join billing_config b on b.client_id = c.id
    where c.active = true
      and c.name not in ('Manual Orders', 'Rate Browser', 'Api Shipments')
      and coalesce(b.active, true) = true
      and ${billingClientScopePredicate(input)}
      ${input.clientId !== undefined ? sql`and c.id = ${input.clientId}` : sql``}
    order by c.name asc
  `);
  if (!configs.length) {
    return {
      generated: 0,
      count: 0,
      total: 0,
      skipped: 0,
      message: 'No billing configs found',
    };
  }

  const configByClient = new Map(configs.map((c) => [c.clientId, c]));

  const clientRows = await db
    .select({ id: clients.id, storeIds: clients.storeIds })
    .from(clients);
  const clientByStore = new Map<number, number>();
  for (const c of clientRows) {
    for (const storeId of c.storeIds ?? []) {
      clientByStore.set(storeId, c.id);
    }
  }

  const orderShipmentRows = await db
    .select({
      shipmentId: shipments.id,
      shipmentClientId: shipments.clientId,
      shipDate: shipments.shipDate,
      labelCost: shipments.labelCost,
      cost: shipments.cost,
      otherCost: shipments.otherCost,
      selectedRateJson: shipments.selectedRateJson,
      selectedPid: shipments.selectedPid,
      selectedPackageId: shipments.selectedPackageId,
      dimsL: shipments.dimsL,
      dimsW: shipments.dimsW,
      dimsH: shipments.dimsH,
      rateDimsL: orderOverrides.rateDimsL,
      rateDimsW: orderOverrides.rateDimsW,
      rateDimsH: orderOverrides.rateDimsH,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderClientId: orders.clientId,
      orderDate: orders.orderDate,
      orderStoreId: orders.storeId,
      orderItems: orders.items,
      orderRaw: orders.raw,
    })
    .from(orders)
    .leftJoin(
      shipments,
      and(eq(shipments.orderId, orders.id), eq(shipments.voided, false))
    )
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(
      and(
        eq(orders.orderStatus, 'shipped'),
        eq(orders.externallyShipped, false),
        sql`coalesce(${orders.raw}->>'externallyFulfilled', 'false') <> 'true'`,
        sql`coalesce(${shipments.shipDate}, ${orders.orderDate}) >= ${fromIso}::timestamptz`,
        sql`coalesce(${shipments.shipDate}, ${orders.orderDate}) < ${toIso}::timestamptz`,
        // CP-019: never pull orders outside the caller's tenant scope.
        billingOrderScopePredicate(input)
      )
    );

  function rawStoreId(
    raw: Record<string, unknown>,
    orderStoreId: number | null
  ): number | null {
    if (orderStoreId !== null) return orderStoreId;
    const advanced =
      raw.advancedOptions && typeof raw.advancedOptions === 'object'
        ? (raw.advancedOptions as Record<string, unknown>)
        : {};
    const rawStore = advanced.storeId ?? raw.storeId;
    const n = Number(rawStore);
    return Number.isFinite(n) ? n : null;
  }

  type BillableRow = {
    id: number | null;
    orderId: number | null;
    orderNumber: string | null;
    clientId: number | null;
    shipDate: Date | null;
    labelCost: string | null;
    cost: string | null;
    otherCost: string | null;
    selectedRateJson: unknown;
    selectedPid: number | null;
    selectedPackageId: string | null;
    dimsL: number | null;
    dimsW: number | null;
    dimsH: number | null;
    rateDimsL: number | null;
    rateDimsW: number | null;
    rateDimsH: number | null;
    items: unknown[];
  };

  const billableRows: BillableRow[] = orderShipmentRows
    .map((row) => {
      const storeId = rawStoreId(row.orderRaw ?? {}, row.orderStoreId ?? null);
      const clientId =
        (storeId !== null ? clientByStore.get(storeId) ?? null : null) ??
        row.orderClientId ??
        row.shipmentClientId ??
        null;
      return {
        id: row.shipmentId,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        clientId,
        shipDate: row.shipDate ?? row.orderDate,
        labelCost: row.labelCost,
        cost: row.cost,
        otherCost: row.otherCost,
        selectedRateJson: row.selectedRateJson,
        selectedPid: row.selectedPid,
        selectedPackageId: row.selectedPackageId,
        dimsL: row.dimsL,
        dimsW: row.dimsW,
        dimsH: row.dimsH,
        rateDimsL: row.rateDimsL,
        rateDimsW: row.rateDimsW,
        rateDimsH: row.rateDimsH,
        items: Array.isArray(row.orderItems) ? row.orderItems : [],
      };
    })
    .filter(
      (row) =>
        row.shipDate !== null &&
        (input.clientId === undefined || row.clientId === input.clientId)
    );

  if (!billableRows.length) {
    return {
      generated: 0,
      count: 0,
      total: 0,
      skipped: 0,
      message: 'No billable shipped orders or shipments found for this range.',
    };
  }

  // Rebuild the requested billing period only after we know the source query
  // has billable rows. That protects existing summaries if a transient query
  // problem happens during generation.
  await db.delete(billingLineItems).where(
    and(
      sql`${billingLineItems.shipDate} >= ${fromIso}::timestamptz`,
      sql`${billingLineItems.shipDate} < ${toIso}::timestamptz`,
      // CP-019: ALWAYS restrict the destructive delete to the caller's tenant
      // scope. Without this, an omitted clientId deleted every tenant's billing
      // rows in the range; a restricted caller with no resolvable scope now
      // deletes nothing (predicate → `false`).
      billingLineItemScopePredicate(input),
      input.clientId !== undefined
        ? eq(billingLineItems.clientId, input.clientId)
        : undefined
    )
  );

  // ─── B2 pre-fetch: packages + per-client package prices ──────────────────
  // Three lookup maps for the resolvePackageId resolver:
  //   packagesById     — shipment.selectedPid → package
  //   packagesByCode   — shipment.selectedPackageId (text ShipStation code)
  //   packagesByDims   — dims fallback when no explicit pid/code on shipment
  // Pricing is keyed (clientId, packageId) with `isCustom` meaning "don't
  // overwrite on set-default"; for computation both kinds are equal.
  const allPackages = await db
    .select({
      id: packages.id,
      name: packages.name,
      packageCode: packages.packageCode,
      length: packages.length,
      width: packages.width,
      height: packages.height,
    })
    .from(packages);

  type PkgRow = (typeof allPackages)[number];
  const packagesById = new Map<number, PkgRow>();
  const packagesByCode = new Map<string, PkgRow>();
  const packagesByDims = new Map<string, PkgRow>();
  const packagesByRoundedDims = new Map<string, PkgRow>();
  const dimsKey = (l: number, w: number, h: number): string =>
    `${l}×${w}×${h}`;
  const roundedDimsKey = (l: number, w: number, h: number): string =>
    `${Math.round(l)}x${Math.round(w)}x${Math.round(h)}`;
  for (const p of allPackages) {
    packagesById.set(p.id, p);
    if (p.packageCode) packagesByCode.set(p.packageCode, p);
    if (p.length > 0 && p.width > 0 && p.height > 0) {
      packagesByDims.set(dimsKey(p.length, p.width, p.height), p);
      packagesByRoundedDims.set(roundedDimsKey(p.length, p.width, p.height), p);
    }
  }

  const clientIdsInScope = [...configByClient.keys()];
  const priceRows = clientIdsInScope.length
    ? await db
        .select()
        .from(clientPackagePrices)
        .where(inArray(clientPackagePrices.clientId, clientIdsInScope))
    : [];
  const pricesByClient = new Map<number, Map<number, number>>();
  for (const r of priceRows) {
    let m = pricesByClient.get(r.clientId);
    if (!m) {
      m = new Map();
      pricesByClient.set(r.clientId, m);
    }
    m.set(r.packageId, Number(r.price));
  }

  const skuPackageRows = await db
    .select({
      clientId: inventory.clientId,
      sku: inventory.sku,
      packageId: inventory.packageId,
    })
    .from(inventory)
    .where(eq(inventory.active, true));
  const packageByClientSku = new Map<string, number>();
  const packageBySku = new Map<string, number>();
  for (const row of skuPackageRows) {
    if (row.packageId === null) continue;
    if (row.clientId !== null) {
      packageByClientSku.set(`${row.clientId}:${row.sku}`, row.packageId);
    }
    if (!packageBySku.has(row.sku)) packageBySku.set(row.sku, row.packageId);
  }

  function packageIdFromItems(items: unknown[], clientId: number): number | null {
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      if ((it as { adjustment?: unknown }).adjustment === true) continue;
      const sku = (it as { sku?: unknown }).sku;
      if (typeof sku !== 'string' || !sku) continue;
      const packageId =
        packageByClientSku.get(`${clientId}:${sku}`) ?? packageBySku.get(sku);
      if (packageId != null && packagesById.has(packageId)) return packageId;
    }
    return null;
  }

  function resolvePackageId(s: {
    clientId: number;
    items: unknown[];
    selectedPid: number | null;
    selectedPackageId: string | null;
    dimsL: number | null;
    dimsW: number | null;
    dimsH: number | null;
    rateDimsL: number | null;
    rateDimsW: number | null;
    rateDimsH: number | null;
  }): number | null {
    // v2 resolves billed box cost from SKU first, then shipment dims, then
    // reference-rate dims. Selected package fields are only a v4 fallback.
    {
      const packageId = packageIdFromItems(s.items, s.clientId);
      if (packageId != null) return packageId;
    }
    if (s.dimsL != null && s.dimsW != null && s.dimsH != null) {
      const exact = packagesByDims.get(dimsKey(s.dimsL, s.dimsW, s.dimsH));
      if (exact) return exact.id;
      const rounded = packagesByRoundedDims.get(
        roundedDimsKey(s.dimsL, s.dimsW, s.dimsH)
      );
      if (rounded) return rounded.id;
    }
    if (s.rateDimsL != null && s.rateDimsW != null && s.rateDimsH != null) {
      const exact = packagesByDims.get(dimsKey(s.rateDimsL, s.rateDimsW, s.rateDimsH));
      if (exact) return exact.id;
      const rounded = packagesByRoundedDims.get(
        roundedDimsKey(s.rateDimsL, s.rateDimsW, s.rateDimsH)
      );
      if (rounded) return rounded.id;
    }
    // 1. Explicit integer custom-package FK on the shipment.
    if (s.selectedPid != null && packagesById.has(s.selectedPid)) {
      return s.selectedPid;
    }
    // 2. Text code — could be numeric id stringified, or a ShipStation
    //    package_code (e.g. "large_flat_rate_box"). Try both.
    if (s.selectedPackageId) {
      const asInt = Number.parseInt(s.selectedPackageId, 10);
      if (Number.isFinite(asInt) && packagesById.has(asInt)) return asInt;
      const byCode = packagesByCode.get(s.selectedPackageId);
      if (byCode) return byCode.id;
    }
    const bySku = packageIdFromItems(s.items, s.clientId);
    if (bySku != null) return bySku;
    // 3. Exact dims match (v2 makeDimsKey parity — unsorted, verbatim).
    if (s.dimsL != null && s.dimsW != null && s.dimsH != null) {
      const match = packagesByDims.get(dimsKey(s.dimsL, s.dimsW, s.dimsH));
      if (match) return match.id;
    }
    return null;
  }

  let generated = 0;
  let skipped = 0;
  let total = 0;

  // Collect ALL line-item rows across every billable shipped order first, then run a
  // single batched INSERT at the end. Previous per-row insert + ON
  // CONFLICT DO NOTHING loop was the bottleneck (16K round-trips over a
  // 3,267-shipment generate). Batched upsert turns that into ~32
  // round-trips (chunks of 500).
  type LineRow = {
    clientId: number;
    orderId: number | null;
    orderNumber: string | null;
    shipmentId: number | null;
    shipDate: Date | null;
    lineType: string;
    description: string;
    qty: string;
    unitCost: string;
    totalCost: string;
  };
  const allRows: LineRow[] = [];

  for (const s of billableRows) {
    if (s.clientId === null) {
      skipped += 1;
      continue;
    }
    const clientId = s.clientId;
    const cfg = configByClient.get(clientId);
    if (!cfg) {
      skipped += 1;
      continue;
    }

    const rows: LineRow[] = [];

    const pickPackFee = toNum(cfg.pickPackFee);
    if (pickPackFee > 0) {
      rows.push({
        clientId,
        orderId: s.orderId,
        orderNumber: s.orderNumber,
        shipmentId: s.id,
        shipDate: s.shipDate,
        lineType: 'pick_pack',
        description: `Pick/pack for order ${s.orderNumber ?? s.orderId}`,
        qty: '1',
        unitCost: pickPackFee.toFixed(2),
        totalCost: pickPackFee.toFixed(2),
      });
    }

    // ─── Additional-unit fee (gap B1) ───────────────────────────────────────
    // Every unit past pickPackMaxUnits on the order is billed at
    // additionalUnitFee each. Threshold is now per-client (was hardcoded);
    // defaults to 1 via schema default and the constant below as a belt-and-
    // braces fallback for any row missing the column.
    const additionalUnitFee = toNum(cfg.additionalUnitFee);
    const maxUnits =
      typeof cfg.pickPackMaxUnits === 'number' && cfg.pickPackMaxUnits > 0
        ? cfg.pickPackMaxUnits
        : PICK_PACK_MAX_UNITS_DEFAULT;
    const items = Array.isArray(s.items) ? s.items : [];
    const totalUnits = totalUnitsFromItems(items);
    if (totalUnits > maxUnits && additionalUnitFee > 0) {
      const extraUnits = totalUnits - maxUnits;
      const extraCost = extraUnits * additionalUnitFee;
      rows.push({
        clientId,
        orderId: s.orderId,
        orderNumber: s.orderNumber,
        shipmentId: s.id,
        shipDate: s.shipDate,
        lineType: 'additional_unit',
        description: `Additional units (×${extraUnits})`,
        qty: String(extraUnits),
        unitCost: additionalUnitFee.toFixed(2),
        totalCost: extraCost.toFixed(2),
      });
    }

    // PS-437: Client Portal does not calculate outbound or return postage.
    // This legacy generator may consume only PrepShip's frozen shipment tuple.
    const frozenShippingMoney = readFrozenCustomerShippingMoney(s.selectedRateJson);
    if (frozenShippingMoney) {
      const cShippingRate = frozenShippingMoney.cShippingRateAmount;
        rows.push({
          clientId,
          orderId: s.orderId,
          orderNumber: s.orderNumber,
          shipmentId: s.id,
          shipDate: s.shipDate,
          lineType: 'shipping',
          // CP-036: policy-free description — no internal markup / override /
          // below-trigger wording may appear in a billing description (pinned by
          // scripts/billing-description-policy-free-guard.mjs). shipmentId keeps it
          // unique per label so multiple shipments on one order can't collide on
          // the (order_id, line_type, description) unique key — mirrors the return
          // lines below.
          description: `Order ${s.orderNumber ?? s.orderId} · shipping · shipment #${s.id}`,
          qty: '1',
          unitCost: cShippingRate.toFixed(2),
          totalCost: cShippingRate.toFixed(2),
        });
    }

    // ─── Package cost (gap B2) ──────────────────────────────────────────────
    // Resolve which custom package was used on this shipment (selectedPid →
    // selectedPackageId → dims match), look up the client's price for it,
    // then emit a package_cost line. packageCostMarkup on the billing config
    // is applied as a percent on top of the base price.
    const resolvedPkgId = resolvePackageId({ ...s, clientId });
    if (resolvedPkgId != null) {
      const basePrice = pricesByClient.get(clientId)?.get(resolvedPkgId);
      if (basePrice != null && basePrice > 0) {
        const markupPct = toNum(cfg.packageCostMarkup);
        const effectivePrice = basePrice * (1 + markupPct / 100);
        const pkgName =
          packagesById.get(resolvedPkgId)?.name ?? `Box #${resolvedPkgId}`;
        rows.push({
          clientId,
          orderId: s.orderId,
          orderNumber: s.orderNumber,
          shipmentId: s.id,
          shipDate: s.shipDate,
          lineType: 'package_cost',
          description: `Box (${pkgName})`,
          qty: '1',
          unitCost: effectivePrice.toFixed(2),
          totalCost: effectivePrice.toFixed(2),
        });
      }
    }

    // Collect for batch insert instead of inserting one at a time.
    for (const row of rows) {
      allRows.push(row);
      total += toNum(row.totalCost);
    }
  }

  // ─── CP-031: return postage + return processing fee ─────────────────────────
  // Return billing flows through the SAME billing SOT as outbound: the lines are
  // collected into `allRows` here, INSIDE the same delete-then-regenerate window
  // opened above (the tenant-scoped DELETE over ship_date ∈ [from,to]) and share
  // the same batched INSERT below. A rerun for the period therefore replaces the
  // return lines cleanly — no duplicates. Return lines use EXPLICIT lineTypes
  // (`return_postage` / `return_processing_fee`), never the outbound `shipping`
  // lineType, so there is no collision with outbound generation.
  //
  // Source: non-voided return shipments (shipments.is_return = true) whose label/
  // ship date falls in the period, joined to their originating order for
  // orderId/orderNumber/clientId. Voided return labels are excluded here (and so
  // are never billed). Tenant scope is applied via billingOrderScopePredicate,
  // the same predicate the outbound source query uses.
  const returnShipmentRows = await db
    .select({
      shipmentId: shipments.id,
      shipmentClientId: shipments.clientId,
      shipDate: shipments.shipDate,
      labelShipDate: shipments.labelShipDate,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      returnReference: returns.returnReference,
      returnCustomerShippingRate: returns.returnCustomerShippingRate,
      orderClientId: orders.clientId,
      orderStoreId: orders.storeId,
      orderDate: orders.orderDate,
      orderRaw: orders.raw,
    })
    .from(shipments)
    .innerJoin(orders, eq(shipments.orderId, orders.id))
    .leftJoin(returns, eq(returns.returnShipmentId, shipments.id))
    .where(
      and(
        eq(shipments.isReturn, true),
        // Skip voided return labels — a voided return is never billed.
        eq(shipments.voided, false),
        sql`coalesce(${shipments.labelShipDate}, ${shipments.shipDate}, ${orders.orderDate}) >= ${fromIso}::timestamptz`,
        sql`coalesce(${shipments.labelShipDate}, ${shipments.shipDate}, ${orders.orderDate}) < ${toIso}::timestamptz`,
        // CP-019 tenant scope — never pull returns outside the caller's scope.
        billingOrderScopePredicate(input)
      )
    );

  for (const r of returnShipmentRows) {
    const storeId = rawStoreId(r.orderRaw ?? {}, r.orderStoreId ?? null);
    const clientId =
      (storeId !== null ? clientByStore.get(storeId) ?? null : null) ??
      r.orderClientId ??
      r.shipmentClientId ??
      null;
    if (clientId === null) {
      skipped += 1;
      continue;
    }
    if (input.clientId !== undefined && clientId !== input.clientId) continue;
    const cfg = configByClient.get(clientId);
    if (!cfg) {
      skipped += 1;
      continue;
    }
    // Persisted ship_date MUST match the coalesce the source query filters on, so
    // a rerun's delete window (which filters billing_line_items.ship_date ∈
    // [from,to]) always catches these return lines and replaces them — no dup.
    const labelDate = r.labelShipDate ?? r.shipDate ?? r.orderDate ?? null;
    const returnReference = resolveReturnReference(r.returnReference, r.orderNumber, r.orderId);

    // ── return_postage ──────────────────────────────────────────────────────
    // PS-437: this field is a compatibility alias copied from PrepShip's frozen
    // shipment tuple. Missing truth is reconciliation work, never raw-cost math.
    const returnRate = r.returnCustomerShippingRate != null
      ? toNum(r.returnCustomerShippingRate)
      : 0;
    if (r.returnCustomerShippingRate == null) {
      skipped += 1;
      console.warn('[billing] return postage skipped: canonical customer snapshot missing', {
        returnShipmentId: r.shipmentId,
        orderId: r.orderId,
      });
    }
    if (returnRate > 0) {
      allRows.push({
        clientId,
        orderId: r.orderId,
        orderNumber: returnReference,
        shipmentId: r.shipmentId,
        shipDate: labelDate,
        lineType: 'return_postage',
        // shipmentId keeps the description unique per return label, so multiple
        // returns on one order don't collide on (order_id, line_type, description).
        description: `${returnReference} · return postage · return #${r.shipmentId}`,
        qty: '1',
        unitCost: returnRate.toFixed(2),
        totalCost: returnRate.toFixed(2),
      });
      total += returnRate;
    }

    // ── return_processing_fee ───────────────────────────────────────────────
    // One per non-voided return shipment when the client configures a fee.
    const processingFee = toNum(cfg.returnProcessingFee);
    if (processingFee > 0) {
      allRows.push({
        clientId,
        orderId: r.orderId,
        orderNumber: returnReference,
        shipmentId: r.shipmentId,
        shipDate: labelDate,
        lineType: 'return_processing_fee',
        description: `${returnReference} · return processing fee · return #${r.shipmentId}`,
        qty: '1',
        unitCost: processingFee.toFixed(2),
        totalCost: processingFee.toFixed(2),
      });
      total += processingFee;
    }
  }

  // Batch INSERT in chunks of 500 with ON CONFLICT DO NOTHING. The unique
  // constraint (order_id, line_type, description) still guards against
  // duplicates, so re-running the generate is idempotent.
  const CHUNK = 500;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    try {
      await db
        .insert(billingLineItems)
        .values(chunk)
        .onConflictDoNothing({
          target: [
            billingLineItems.orderId,
            billingLineItems.lineType,
            billingLineItems.description,
          ],
        });
      generated += chunk.length;
    } catch {
      // Fall back to per-row to isolate which row poisoned the chunk.
      for (const row of chunk) {
        try {
          await db
            .insert(billingLineItems)
            .values(row)
            .onConflictDoNothing({
              target: [
                billingLineItems.orderId,
                billingLineItems.lineType,
                billingLineItems.description,
              ],
            });
          generated += 1;
        } catch {
          skipped += 1;
        }
      }
    }
  }

  // ─── Storage fees (once per client per billing period) ──────────────────────
  // v2 charged storage per cuft/month on current inventory on hand. v4
  // approximates: for each client with storageFeePerCuFt > 0, compute
  // SUM(stock_qty × cuFt_per_unit) × feeRate, emitted as one line item
  // dated on the last billed day so it remains inside [dateFrom, dateTo).
  const periodEnd = new Date(input.dateTo);
  const STORAGE_LINE_DAY_MS = 24 * 60 * 60 * 1000;
  const storageShipDate = new Date(periodEnd.getTime() - STORAGE_LINE_DAY_MS);
  for (const [clientId, cfg] of configByClient.entries()) {
    const storageRate = toNum(cfg.storageFeePerCuFt ?? 0);
    if (storageRate <= 0) continue;
    if (cfg.active === false) continue;

    const invRows = await db.execute<{
      total_cuft: string | number | null;
    }>(sql`
      select
        coalesce(sum(
          case
            when coalesce(cu_ft_override, 0) > 0 then stock_qty * cu_ft_override
            when length > 0 and width > 0 and height > 0
              then stock_qty * ((length * width * height) / 1728.0)
            else 0
          end
        ), 0)::numeric(14,4) as total_cuft
      from inventory
      where client_id = ${clientId}
        and active = true
        and stock_qty > 0
    `);
    const totalCuFt = Number(invRows[0]?.total_cuft ?? 0);
    if (totalCuFt <= 0) continue;
    const fee = totalCuFt * storageRate;
    if (fee <= 0) continue;

    try {
      await db
        .insert(billingLineItems)
        .values({
          clientId,
          orderId: null,
          orderNumber: null,
          shipmentId: null,
          shipDate: storageShipDate,
          lineType: 'storage',
          description: `Storage — ${totalCuFt.toFixed(2)} cuft × $${storageRate.toFixed(4)}/cuft`,
          qty: totalCuFt.toFixed(2),
          unitCost: storageRate.toFixed(4),
          totalCost: fee.toFixed(2),
        })
        .onConflictDoNothing({
          target: [
            billingLineItems.orderId,
            billingLineItems.lineType,
            billingLineItems.description,
          ],
        });
      generated += 1;
      total += fee;
    } catch {
      skipped += 1;
    }
  }

  let billingSummaryMetricsRows: number | null = null;
  try {
    billingSummaryMetricsRows = await refreshBillingSummaryMetrics(
      new Date(input.dateFrom),
      new Date(input.dateTo)
    );
  } catch (err) {
    console.warn(
      '[billing] generated line items but failed to refresh summary metrics:',
      err instanceof Error ? err.message : err
    );
  }

  return {
    generated,
    count: generated,
    total,
    skipped,
    billingSummaryMetricsRows,
    message: `Generated ${generated} line items from ${billableRows.length} billable shipments/orders.`,
  };
}

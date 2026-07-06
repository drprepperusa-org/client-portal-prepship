import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../lib/env';
import { shipments } from '../db/schema/shipments';
import { orders } from '../db/schema/orders';
import { clients } from '../db/schema/clients';
import { returns } from '../db/schema/returns';
import { locations } from '../db/schema/locations';
import { getDefaultLocation } from './locations';
import { getRates, isBlockedRate, type RateInput } from './rates';
import { carrierConnectors } from '../connectors/registry';
import {
  extractShipstationLabelUrl,
  type CreatedExternalLabel,
  type ShipstationAddressInput,
} from '../lib/shipstation/labels';
import { resolveReturnPostageRate } from './billing';
import { loadClientCredentials } from '../lib/shipstation/credentials';
import {
  generateFakeShipmentId,
  generateFakeTrackingNumber,
  generateMockLabelPdf,
  serviceCodeToLabel,
  type MockLabelData,
} from './mock-label-generator';
import { saveMockLabel } from './mock-label-store';
import { addMockLabelSignature } from '../lib/mock-label-access';
import type { Location } from '../db/schema/locations';
import type { Rate } from '../lib/shipstation';

// ── CP-027 — backend return-label service ─────────────────────────────────────
//
// PrepShip backend creates and OWNS the return-label workflow. It selects the
// cheapest eligible rate backend-side, purchases (or offline-mocks) the label,
// persists the canonical shipments row, and hands the caller a CLIENT-SAFE
// result that exposes only returnCustomerShippingRate / tracking / status / PDF
// availability — never carrier / service / provider / selected-rate.
//
// SAFETY: no real postage is purchasable by default. The live ShipStation
// purchase path may run ONLY when `env.RETURNS_LIVE_LABELS` is truthy AND the
// resolved client is not an isTest client. Otherwise the service takes the
// OFFLINE MOCK path (fake tracking, cost '0.00', source 'test_offline', no
// carrier call) — mirroring labels.ts createLabelV2's testLabel branch.

export type CreateReturnLabelInput = {
  returnId?: number;
  originalShipmentId?: number;
  orderId?: number;
  reason?: string;
  adminOverride?: boolean;
  adminOverrideReason?: string;
  actorEmail?: string;
};

/**
 * The ONLY shape a client/customer surface may see. Deliberately omits
 * carrierCode / serviceCode / providerAccountId / selectedRateJson and every
 * other carrier/service/provider identifier. Internal/admin callers read the
 * full shipments row separately.
 */
export type ClientSafeReturnResult = {
  returnCustomerShippingRate: number;
  trackingNumber: string | null;
  trackingStatus: string | null;
  labelAvailable: boolean;
  pdfAvailable: boolean;
  returnShipmentId: number | null;
  createdAt: string;
};

type OutboundShipment = typeof shipments.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

function orderShipToFromRaw(order: {
  raw: Record<string, unknown>;
  shipToName: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
}): ShipstationAddressInput {
  const raw = order.raw ?? {};
  const shipTo = (raw.shipTo as Record<string, unknown> | undefined) ?? {};
  return {
    name: (shipTo.name as string | undefined) ?? order.shipToName ?? 'Customer',
    company: (shipTo.company as string | undefined) ?? undefined,
    street1: (shipTo.street1 as string | undefined) ?? '',
    street2: (shipTo.street2 as string | undefined) ?? undefined,
    city: (shipTo.city as string | undefined) ?? order.shipToCity ?? '',
    state: (shipTo.state as string | undefined) ?? order.shipToState ?? '',
    postalCode: (shipTo.postalCode as string | undefined) ?? order.shipToPostalCode ?? '',
    country: (shipTo.country as string | undefined) ?? 'US',
    phone: (shipTo.phone as string | undefined) ?? undefined,
  };
}

function locationToAddress(loc: Location): ShipstationAddressInput {
  return {
    name: loc.name,
    company: loc.company ?? undefined,
    street1: loc.street1 ?? '',
    street2: loc.street2 ?? undefined,
    city: loc.city ?? '',
    state: loc.state ?? '',
    postalCode: loc.postalCode ?? '',
    country: loc.country ?? 'US',
    phone: loc.phone ?? undefined,
  };
}

function assertAddressComplete(
  addr: ShipstationAddressInput,
  label: string,
): asserts addr is ShipstationAddressInput {
  const missing: string[] = [];
  if (!addr.street1) missing.push('street1');
  if (!addr.city) missing.push('city');
  if (!addr.state) missing.push('state');
  if (!addr.postalCode) missing.push('postalCode');
  if (missing.length) {
    throw new Error(`Return ${label} address is missing required fields: ${missing.join(', ')}`);
  }
}

async function resolveClientId(order: OrderRow): Promise<number | null> {
  if (order.clientId) return order.clientId;
  if (order.storeId != null) {
    const [match] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(sql`${clients.storeIds} @> ${[order.storeId]}::integer[]`)
      .limit(1);
    return match?.id ?? null;
  }
  return null;
}

async function clientIsTest(clientId: number | null): Promise<boolean> {
  if (!clientId) return false;
  const [cli] = await db
    .select({ isTest: clients.isTest })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  return Boolean(cli?.isTest);
}

async function loadOrder(orderId: number): Promise<OrderRow | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return order ?? null;
}

async function loadShipmentById(shipmentId: number): Promise<OutboundShipment | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(or(eq(shipments.id, shipmentId), eq(shipments.labelShipmentId, shipmentId)))
    .limit(1);
  return row ?? null;
}

async function loadLatestOutboundForOrder(orderId: number): Promise<OutboundShipment | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(
      and(eq(shipments.orderId, orderId), eq(shipments.voided, false), eq(shipments.isReturn, false)),
    )
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  return row ?? null;
}

/** An existing, non-voided return shipment for this order (duplicate guard). */
async function findActiveReturnForOrder(orderId: number): Promise<OutboundShipment | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(
      and(eq(shipments.orderId, orderId), eq(shipments.voided, false), eq(shipments.isReturn, true)),
    )
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  return row ?? null;
}

const toNum = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * CP-027 client-facing returnCustomerShippingRate — derived from the SAME backend billing
 * policy that generates the `return_postage` billing line (CP-031's
 * `resolveReturnPostageRate` in billing.ts), so the price a customer is quoted
 * equals the amount that will actually be billed. ONE definition, no drift.
 *
 * Parity with billing generation (see billing.ts generateLineItems):
 *  - house cost 0 (offline-mock / no synced cost) → 0. Billing generates NO
 *    `return_postage` line for a 0 house cost, so the quote is likewise 0.
 *  - house cost > 0 → the client's return markup + min-price override applied.
 *    With all-zero / absent config this reduces to the raw house cost (no
 *    regression from the prior raw-cost behaviour).
 *
 * PARITY INVARIANT: this service persists return shipments with cost = rawCost
 * and NO otherCost, so billing's houseCost = (cost || labelCost) + otherCost
 * equals the rawCost passed here. Keep it that way — if a future sync ever
 * backfills shipments.otherCost on a return row, add it into rawCost at the call
 * sites too, or the quote (single rawCost) would drift from the billed line.
 *
 * The raw house/label cost is NEVER surfaced to the client — only this
 * policy-derived amount ever reaches ClientSafeReturnResult.returnCustomerShippingRate.
 */
export async function resolveReturnCustomerPrice(rawCost: number, clientId: number | null): Promise<number> {
  const houseCost = toNum(rawCost);
  if (houseCost <= 0) return 0;
  if (clientId == null) return Number(houseCost.toFixed(2));
  try {
    const cfgRows = await db.execute<{
      returnPostageMarkupPct: string;
      returnPostageMarkupFlat: string;
      returnShippingRateOverrideTriggerBelow: string;
      returnShippingRateOverrideAmount: string;
    }>(sql`
      select
        coalesce(return_postage_markup_pct, '0'::numeric)::text as "returnPostageMarkupPct",
        coalesce(return_postage_markup_flat, '0'::numeric)::text as "returnPostageMarkupFlat",
        coalesce(return_shipping_rate_override_trigger_below, '0'::numeric)::text as "returnShippingRateOverrideTriggerBelow",
        coalesce(return_shipping_rate_override_amount, '0'::numeric)::text as "returnShippingRateOverrideAmount"
      from billing_config
      where client_id = ${clientId}
      limit 1
    `);
    const cfg = cfgRows[0];
    const { returnRate } = resolveReturnPostageRate({
      houseCost,
      markupPct: toNum(cfg?.returnPostageMarkupPct),
      markupFlat: toNum(cfg?.returnPostageMarkupFlat),
      triggerBelow: toNum(cfg?.returnShippingRateOverrideTriggerBelow),
      overrideAmount: toNum(cfg?.returnShippingRateOverrideAmount),
    });
    return Number(returnRate.toFixed(2));
  } catch (err) {
    console.warn('[returns] return price policy load failed; quoting raw house cost:', err);
    return Number(houseCost.toFixed(2));
  }
}

function toClientSafeResult(args: {
  returnCustomerShippingRate: number;
  trackingNumber: string | null;
  trackingStatus: string | null;
  labelUrl: string | null;
  returnShipmentId: number | null;
  createdAt: Date;
}): ClientSafeReturnResult {
  const hasLabel = Boolean(args.labelUrl);
  return {
    returnCustomerShippingRate: args.returnCustomerShippingRate,
    trackingNumber: args.trackingNumber,
    trackingStatus: args.trackingStatus,
    labelAvailable: hasLabel,
    pdfAvailable: hasLabel,
    returnShipmentId: args.returnShipmentId,
    createdAt: args.createdAt.toISOString(),
  };
}

/**
 * Persist the canonical return shipment row (shipments is the SOT for return
 * label/tracking/cost). Mirrors persistCreatedLabel's field set. Best-effort
 * mirrors into return_labels afterward.
 */
async function persistReturnShipment(args: {
  outbound: OutboundShipment;
  orderId: number | null;
  clientId: number | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  cost: number;
  carrierCode: string | null;
  serviceCode: string | null;
  providerAccountId: number | null;
  selectedRate: Rate | CreatedExternalLabel | null;
  labelFormat: string;
  labelShipmentId: number | null;
  source: string;
  reason: string;
  createdAt: Date;
}): Promise<number> {
  const costStr = args.cost.toFixed(2);
  const [row] = await db
    .insert(shipments)
    .values({
      orderId: args.orderId,
      clientId: args.clientId,
      orderNumber: args.orderNumber,
      carrierCode: args.carrierCode,
      serviceCode: args.serviceCode,
      trackingNumber: args.trackingNumber,
      shipDate: args.createdAt,
      createDate: args.createdAt,
      weightOz: args.outbound.weightOz,
      dimsL: args.outbound.dimsL,
      dimsW: args.outbound.dimsW,
      dimsH: args.outbound.dimsH,
      cost: costStr,
      labelUrl: args.labelUrl,
      labelCreatedAt: args.createdAt,
      labelFormat: args.labelFormat,
      labelCarrier: args.carrierCode,
      labelService: args.serviceCode,
      labelTracking: args.trackingNumber,
      labelCost: costStr,
      labelShipDate: args.createdAt,
      labelShipmentId: args.labelShipmentId,
      labelProvider: args.providerAccountId,
      providerAccountId: args.providerAccountId,
      selectedRateJson: args.selectedRate as unknown as Record<string, unknown> | null,
      voided: false,
      source: args.source,
      isReturn: true,
      returnForShipmentId: args.outbound.id,
      returnReason: args.reason,
    })
    .returning({ id: shipments.id });
  if (!row) throw new Error('Failed to persist return shipment row');

  // Best-effort v2 mirror — the canonical truth is shipments.isReturn.
  try {
    const { returnLabels } = await import('../db/schema/return-labels');
    await db.insert(returnLabels).values({
      shipmentId: args.outbound.id,
      returnShipmentId: row.id,
      returnTrackingNumber: args.trackingNumber,
      reason: args.reason,
    });
  } catch (err) {
    console.warn('[returns] return_labels mirror insert failed:', err);
  }

  return row.id;
}

/** Update a CP-026 returns workflow row once its label exists. */
async function markReturnLabelCreated(returnId: number, returnShipmentId: number): Promise<void> {
  try {
    await db
      .update(returns)
      .set({ status: 'label_created', returnShipmentId, updatedAt: new Date() })
      .where(eq(returns.id, returnId));
  } catch (err) {
    console.warn('[returns] failed to update returns workflow row:', err);
  }
}

/**
 * Create a return label, backend-owned. Returns a CLIENT-SAFE result — no
 * carrier / service / provider / selected-rate is ever exposed to the caller.
 */
export async function createReturnLabel(
  input: CreateReturnLabelInput,
): Promise<ClientSafeReturnResult> {
  const reason = input.reason || 'Customer Return';

  // ── Resolve the CP-026 returns workflow row (optional) ──
  let returnRow: typeof returns.$inferSelect | null = null;
  if (input.returnId != null) {
    const [row] = await db.select().from(returns).where(eq(returns.id, input.returnId)).limit(1);
    returnRow = row ?? null;
    if (!returnRow) throw new Error('Return workflow record not found');
  }

  // ── Resolve the original outbound shipment + order ──
  let outbound: OutboundShipment | null = null;
  if (input.originalShipmentId != null) {
    outbound = await loadShipmentById(input.originalShipmentId);
    if (!outbound) throw new Error('Original shipment not found');
  }

  const orderId = input.orderId ?? outbound?.orderId ?? returnRow?.orderId ?? null;
  if (orderId == null) {
    throw new Error('Cannot create return — no order, shipment, or return record supplied');
  }

  const order = await loadOrder(orderId);
  if (!order) throw new Error('Order not found');

  if (!outbound) {
    outbound = await loadLatestOutboundForOrder(order.id);
    if (!outbound) throw new Error('No outbound shipment found for this order to return');
  }

  const clientId = await resolveClientId(order);
  const isTest = await clientIsTest(clientId);

  // ── Duplicate-active-return guard (code-level; DB partial unique index
  //    returns_one_active_per_order_idx also enforces it). A second active
  //    return requires an explicit, AUDITED admin override. ──
  const existingReturn = await findActiveReturnForOrder(order.id);
  if (existingReturn) {
    if (!input.adminOverride) {
      const err = new Error(
        'An active return already exists for this order. Admin override required to create another.',
      ) as Error & { details?: Record<string, unknown> };
      err.details = { returnShipmentId: existingReturn.id };
      throw err;
    }
    // Record the override audit on the CP-026 workflow row when present.
    if (returnRow) {
      try {
        await db
          .update(returns)
          .set({
            adminOverride: true,
            adminOverrideBy: input.actorEmail ?? null,
            adminOverrideReason: input.adminOverrideReason ?? reason,
            updatedAt: new Date(),
          })
          .where(eq(returns.id, returnRow.id));
      } catch (err) {
        console.warn('[returns] failed to record admin override audit:', err);
      }
    }
    console.info(
      `[returns] admin override: second active return for order ${order.id} by ${input.actorEmail ?? 'unknown'} — reason: ${input.adminOverrideReason ?? reason}`,
    );
  }

  // ── Build the address reversal for the rate quote / label ──
  //   ship_from = buyer/customer (the person returning the package)
  //   ship_to   = return-to location (the warehouse receiving the return)
  const shipFrom = orderShipToFromRaw(order);
  assertAddressComplete(shipFrom, 'ship-from (customer)');

  let returnLocation: Location | null = null;
  if (returnRow?.returnToLocationId != null) {
    const [loc] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, returnRow.returnToLocationId))
      .limit(1);
    returnLocation = loc ?? null;
  }
  // Fall back to the default return-to location when the workflow row has none.
  if (!returnLocation) {
    returnLocation = await getDefaultLocation();
  }
  if (!returnLocation) {
    throw new Error('No default return-to location configured. Set a default Location first.');
  }
  const shipTo = locationToAddress(returnLocation);
  assertAddressComplete(shipTo, 'ship-to (return location)');

  const createdAt = new Date();
  const liveEligible = env.RETURNS_LIVE_LABELS && !isTest;

  // ── CP-032: PrepShip OWNS the return workflow ────────────────────────────────
  // The old ShipStation-return shortcut (delegate to createReturnLabelV2 when the
  // outbound row had a labelShipmentId) is REMOVED. Return-label creation now
  // ALWAYS rate-shops the cheapest ELIGIBLE rate backend-side and buys (live) or
  // offline-mocks (default) the label through PrepShip provider code. ShipStation
  // (and any carrier API) is only ever a provider implementation detail behind
  // this single path — never the owner of the workflow, price choice, customer
  // delivery, or billing truth.
  const weightOz = outbound.weightOz ?? order.weightOz ?? 1;
  const rateInput: RateInput = {
    weightOz,
    // ship_from = customer; to* = return location.
    toZip: shipTo.postalCode ?? '',
    toCountry: shipTo.country ?? 'US',
    toState: shipTo.state ?? undefined,
    toCity: shipTo.city ?? undefined,
    toAddress: shipTo.street1 ?? undefined,
    toName: shipTo.name ?? undefined,
    dimsL: outbound.dimsL ?? undefined,
    dimsW: outbound.dimsW ?? undefined,
    dimsH: outbound.dimsH ?? undefined,
    clientId,
    storeId: order.storeId ?? null,
    shipFrom: {
      name: shipFrom.name ?? undefined,
      company_name: shipFrom.company ?? undefined,
      phone: shipFrom.phone ?? undefined,
      address_line1: shipFrom.street1 ?? '',
      address_line2: shipFrom.street2 ?? undefined,
      city_locality: shipFrom.city ?? '',
      state_province: shipFrom.state ?? '',
      postal_code: shipFrom.postalCode ?? '',
      country_code: shipFrom.country ?? 'US',
    },
  };

  // Only quote the carrier when we will actually buy (the live path below).
  // The offline-mock default never needs a live rate — it persists cost 0.00
  // with a generic service — so getRates is NOT called when the flag is off or
  // the client is a test client. That keeps the default path fully carrier-free.
  let chosen: Rate | null = null;
  let rateCost = 0;
  if (liveEligible) {
    const { rates, bestRate } = await getRates(rateInput);
    // Cheapest ELIGIBLE rate: filter blocked rates first, then take best.
    // getRates sorts cheapest-first and returns bestRate; we re-filter with
    // isBlockedRate defensively and re-pick so a blocked cheapest never wins.
    const eligible = rates.filter((r) => !isBlockedRate(r, order.storeId ?? null));
    chosen =
      (bestRate && !isBlockedRate(bestRate, order.storeId ?? null) ? bestRate : null) ??
      eligible[0] ??
      null;
    rateCost = chosen
      ? Number(chosen.shipping_amount?.amount ?? 0) +
        Number(chosen.confirmation_amount?.amount ?? 0) +
        Number(chosen.other_amount?.amount ?? 0)
      : 0;
  }

  // ── OFFLINE MOCK path (DEFAULT) ──
  // Runs whenever live purchase is not permitted (flag off OR test client).
  // Generates fake tracking, persists source 'test_offline' + cost '0.00', and
  // NEVER calls the carrier. Mirrors labels.ts createLabelV2's testLabel branch.
  if (!liveEligible) {
    const fakeShipmentId = generateFakeShipmentId();
    const fakeTracking = generateFakeTrackingNumber();
    const shipDate = createdAt.toISOString().slice(0, 10);
    const apiBase = (process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '');
    const mockLabelUrlBase = apiBase
      ? `${apiBase}/labels/mock/${fakeShipmentId}`
      : `/labels/mock/${fakeShipmentId}`;
    const mockLabelUrl = addMockLabelSignature(mockLabelUrlBase, fakeShipmentId);

    const mockData: MockLabelData = {
      shipmentId: fakeShipmentId,
      orderNumber: order.orderNumber ?? null,
      trackingNumber: fakeTracking,
      serviceLabel: serviceCodeToLabel(chosen?.service_code ?? 'return'),
      weightOz,
      // Reversed: the label ships FROM the customer TO the return location.
      shipFrom: {
        name: shipFrom.name ?? 'Ship From',
        street1: shipFrom.street1 ?? '',
        city: shipFrom.city ?? '',
        state: shipFrom.state ?? '',
        postalCode: shipFrom.postalCode ?? '',
      },
      shipTo: {
        name: shipTo.name ?? 'Ship To',
        street1: shipTo.street1 ?? '',
        city: shipTo.city ?? '',
        state: shipTo.state ?? '',
        postalCode: shipTo.postalCode ?? '',
      },
      shipDate,
    };
    let pdfBase64: string | undefined;
    try {
      pdfBase64 = await generateMockLabelPdf(mockData);
    } catch (err) {
      console.error('[returns] mock label PDF generation failed:', (err as Error).message);
    }
    saveMockLabel(fakeShipmentId, { ...mockData, pdfBase64 });

    const returnShipmentId = await persistReturnShipment({
      outbound,
      orderId: order.id,
      clientId,
      orderNumber: order.orderNumber ?? null,
      trackingNumber: fakeTracking,
      labelUrl: mockLabelUrl,
      cost: 0,
      // Redaction-safe: carrier/service are NOT persisted for the mock path.
      carrierCode: null,
      serviceCode: null,
      providerAccountId: null,
      selectedRate: null,
      labelFormat: 'html',
      labelShipmentId: fakeShipmentId,
      source: 'test_offline',
      reason,
      createdAt,
    });

    if (returnRow) await markReturnLabelCreated(returnRow.id, returnShipmentId);

    return toClientSafeResult({
      returnCustomerShippingRate: await resolveReturnCustomerPrice(0, clientId),
      trackingNumber: fakeTracking,
      trackingStatus: null,
      labelUrl: mockLabelUrl,
      returnShipmentId,
      createdAt,
    });
  }

  // ── LIVE ShipStation purchase path ──
  // Only reachable when env.RETURNS_LIVE_LABELS is truthy AND client is not
  // isTest (liveEligible) — enforced by the guard above.
  // Reached only when liveEligible is true, so getRates ran and set `chosen`.
  // This narrows the type and defends against an empty eligible-rate set.
  if (!chosen) {
    throw new Error('No eligible return rate available for this shipment');
  }
  const creds = await loadClientCredentials(clientId);
  const created = await carrierConnectors.shipstation.createLabel({
    apiKeyV2: creds.apiKeyV2 ?? undefined,
    carrierId: chosen.carrier_id,
    serviceCode: chosen.service_code,
    packageCode: chosen.package_type || 'package',
    weightOz,
    length: outbound.dimsL,
    width: outbound.dimsW,
    height: outbound.dimsH,
    shipTo,
    shipFrom,
    confirmation: null,
    ssOrderId: order.id,
    orderNumber: order.orderNumber ?? null,
    testLabel: false,
  });

  const labelUrl = extractShipstationLabelUrl(created.labelUrl);
  const returnShipmentId = await persistReturnShipment({
    outbound,
    orderId: order.id,
    clientId,
    orderNumber: order.orderNumber ?? null,
    trackingNumber: created.trackingNumber,
    labelUrl,
    cost: created.cost || rateCost,
    carrierCode: created.carrierCode,
    serviceCode: created.serviceCode,
    providerAccountId: created.providerAccountId,
    selectedRate: created,
    labelFormat: created.labelFormat ?? 'pdf',
    labelShipmentId: created.shipmentId || null,
    source: 'prepship_return_v2',
    reason,
    createdAt,
  });

  if (returnRow) await markReturnLabelCreated(returnRow.id, returnShipmentId);

  return toClientSafeResult({
    returnCustomerShippingRate: await resolveReturnCustomerPrice(created.cost || rateCost, clientId),
    trackingNumber: created.trackingNumber,
    trackingStatus: null,
    labelUrl,
    returnShipmentId,
    createdAt,
  });
}

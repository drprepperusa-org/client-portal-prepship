import { and, eq, or, desc, sql } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';
import { db } from '../db/client';
import { shipments } from '../db/schema/shipments';
import { orders, orderOverrides } from '../db/schema/orders';
import { clients } from '../db/schema/clients';
import {
  ssCreateReturnLabel,
  ssGetShipmentV1,
  ssListRecentLabels,
  ssVoidShipment,
  type CreatedExternalLabel,
  type ShipstationAddressInput,
} from '../lib/shipstation/labels';
import { getDefaultShipFrom } from '../lib/ship-from';
import {
  generateFakeShipmentId,
  generateFakeTrackingNumber,
  generateMockLabelHtml,
  generateMockLabelPdf,
  serviceCodeToLabel,
  type MockLabelData,
} from './mock-label-generator';
import { deductInventoryForOrder, deductPackageForShipment } from './fulfillment-deductions';
import { packages } from '../db/schema/packages';
import { carrierConnectors } from '../connectors/registry';
import {
  enqueueShipmentConfirmation,
  ensureFulfillmentSchema,
  processFulfillmentOutboxOnce,
} from './fulfillment/outbox';
import { addMockLabelSignature } from '../lib/mock-label-access';
import { confirmationProviderForOrder, marketplaceConfirmationPayload } from './labels-confirmation';
import { saveMockLabel } from './mock-label-store';
// CP-057: the intent state machine is owned by return-label-purchase-intents.ts; this file
// reports the confirmed void event and does not reach into the intent schema itself.
import { markReturnLabelPurchaseVoidedForShipment } from './return-label-purchase-intents';

// Batch-label callers don't carry a panel-selected package, so customPackageId
// is often null. When dims are present, fall back to the same ±0.1" tolerance
// that /packages/auto-create uses to find an existing package — without this,
// the package's stock_qty never decrements for batch-issued labels and the
// PACKAGES section count stays flat regardless of how many labels go out.
async function resolveLabelPackageId(args: {
  customPackageId?: number | string | null;
  length: number | null;
  width: number | null;
  height: number | null;
}): Promise<number | null> {
  if (args.customPackageId != null && args.customPackageId !== '') {
    const id = Number(args.customPackageId);
    if (Number.isFinite(id) && id > 0) return id;
  }
  if (args.length && args.width && args.height) {
    const tol = 0.1;
    const [match] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(
        and(
          sql`abs(${packages.length} - ${args.length}) <= ${tol}`,
          sql`abs(${packages.width} - ${args.width}) <= ${tol}`,
          sql`abs(${packages.height} - ${args.height}) <= ${tol}`
        )
      )
      .limit(1);
    if (match) return match.id;
  }
  return null;
}

// Optional local throttle. Disabled by default so batch queue jobs are not capped.
// Set LABEL_RATE_LIMIT to a positive value to re-enable a per-minute client cap.

const LABEL_RATE_LIMIT = Number(process.env.LABEL_RATE_LIMIT ?? 0);
const LABEL_RATE_WINDOW_MS = 60_000;
const labelRateLimitMap = new Map<number, { count: number; windowStart: number }>();

export class LabelRateLimitError extends Error {
  rateLimited = true;
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'LabelRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

type LabelTimer = ReturnType<typeof createLabelTimer>;

function createLabelTimer(orderId: number | string) {
  const started = performance.now();
  const prefix = `[label-create] orderId=${orderId}`;

  const elapsed = () => Math.round(performance.now() - started);

  return {
    async task<T>(step: string, fn: () => Promise<T>): Promise<T> {
      const stepStarted = performance.now();
      try {
        return await fn();
      } finally {
        console.info(`${prefix} ${step} ${Math.round(performance.now() - stepStarted)}ms total=${elapsed()}ms`);
      }
    },
    background(step: string, fn: () => Promise<void>): void {
      void (async () => {
        const stepStarted = performance.now();
        try {
          await fn();
          console.info(`${prefix} ${step} ${Math.round(performance.now() - stepStarted)}ms total=${elapsed()}ms background=ok`);
        } catch (err) {
          console.warn(
            `${prefix} ${step} failed after ${Math.round(performance.now() - stepStarted)}ms total=${elapsed()}ms:`,
            err instanceof Error ? err.message : err
          );
        }
      })();
    },
    done(step: string): void {
      console.info(`${prefix} ${step} total=${elapsed()}ms`);
    },
  };
}

function checkLabelRateLimit(clientId: number): void {
  if (!Number.isFinite(LABEL_RATE_LIMIT) || LABEL_RATE_LIMIT <= 0) return;

  const now = Date.now();
  const bucket = labelRateLimitMap.get(clientId);
  if (!bucket) {
    labelRateLimitMap.set(clientId, { count: 1, windowStart: now });
    return;
  }
  const elapsed = now - bucket.windowStart;
  if (elapsed >= LABEL_RATE_WINDOW_MS) {
    labelRateLimitMap.set(clientId, { count: 1, windowStart: now });
    return;
  }
  if (bucket.count >= LABEL_RATE_LIMIT) {
    throw new LabelRateLimitError(
      `Label rate limit exceeded (${LABEL_RATE_LIMIT}/min per client). Retry after ${Math.ceil((LABEL_RATE_WINDOW_MS - elapsed) / 1000)}s`,
      LABEL_RATE_WINDOW_MS - elapsed
    );
  }
  bucket.count += 1;
}

async function withConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  maxConcurrent = 5
): Promise<void> {
  const queue = [...items];
  const running = new Set<Promise<void>>();
  while (queue.length > 0 || running.size > 0) {
    while (running.size < maxConcurrent && queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        const task = fn(item).finally(() => running.delete(task));
        running.add(task);
      }
    }
    if (running.size > 0) {
      await Promise.race(running);
    }
  }
}

// ── Mock label store ──────────────────────────────────────────────────────────
// Moved to ./mock-label-store (DB-backed with in-memory fast path). Re-exported
// so routes/labels.ts keeps importing from this service.
export { getMockLabel, getMockLabelAsync, saveMockLabel } from './mock-label-store';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AddressInputDto = ShipstationAddressInput;

export type CreateLabelInputDto = {
  orderId: number;
  orderNumber?: string;
  carrierCode?: string;
  serviceCode: string;
  packageCode?: string;
  customPackageId?: number | null;
  shippingProviderId?: number | null;
  weightOz?: number;
  length?: number;
  width?: number;
  height?: number;
  confirmation?: string;
  testLabel?: boolean;
  shipTo?: AddressInputDto;
  shipFrom?: AddressInputDto;
};

export type CreateLabelResponseDto = {
  shipmentId: number;
  trackingNumber: string | null;
  labelUrl: string | null;
  cost: number;
  voided: boolean;
  orderStatus: string;
  apiVersion: 'v2';
};

export type VoidLabelResponseDto = {
  success: true;
  shipmentId: number;
  orderNumber: string | null;
  voided: true;
  voidedAt: string;
  trackingNumber: string | null;
  refundAmount: number | null;
  refundInitiated: true;
  refundEstimate: string;
  note: string;
};

export type ReturnLabelResponseDto = {
  success: true;
  shipmentId: number;
  orderNumber: string | null;
  returnTrackingNumber: string;
  returnShipmentId: number | null;
  cost: number;
  reason: string;
  createdAt: string;
};

export type RetrieveLabelResponseDto = {
  orderId: number | null;
  orderNumber: string | null;
  shipmentId: number;
  trackingNumber: string | null;
  labelUrl: string;
  createdAt: string | null;
  carrier: string;
  service: string;
  cost: number;
};

export type BatchLabelResultItem = {
  orderId: number;
  success: boolean;
  shipmentId?: number;
  trackingNumber?: string | null;
  cost?: number;
  error?: string;
};

export type CreateBatchLabelInputDto = {
  orderIds: number[];
  carrierCode?: string;
  serviceCode: string;
  packageCode?: string;
  confirmation?: string;
  testLabel?: boolean;
  shippingProviderId: number;
};

export type CreateBatchLabelResponseDto = {
  created: BatchLabelResultItem[];
  failed: BatchLabelResultItem[];
  summary: { total: number; created: number; failed: number };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultShipFromAddress(): ShipstationAddressInput {
  return {
    name: 'DR Prepper Fulfillment',
    street1: '14924 S Figueroa St',
    city: 'Gardena',
    state: 'CA',
    postalCode: '90248',
    country: 'US',
    phone: '3103295555',
  };
}

function orderShipToFromRaw(rawOrder: {
  raw: Record<string, unknown>;
  shipToName: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
}): ShipstationAddressInput {
  const raw = rawOrder.raw ?? {};
  const shipTo = (raw.shipTo as Record<string, unknown> | undefined) ?? {};
  return {
    name: (shipTo.name as string | undefined) ?? rawOrder.shipToName ?? 'Customer',
    company: (shipTo.company as string | undefined) ?? undefined,
    street1: (shipTo.street1 as string | undefined) ?? '',
    street2: (shipTo.street2 as string | undefined) ?? undefined,
    city: (shipTo.city as string | undefined) ?? rawOrder.shipToCity ?? '',
    state: (shipTo.state as string | undefined) ?? rawOrder.shipToState ?? '',
    postalCode: (shipTo.postalCode as string | undefined) ?? rawOrder.shipToPostalCode ?? '',
    country: (shipTo.country as string | undefined) ?? 'US',
    phone: (shipTo.phone as string | undefined) ?? undefined,
  };
}

function mergeAddress(
  input: AddressInputDto | undefined,
  fallback: ShipstationAddressInput
): ShipstationAddressInput {
  if (!input?.street1) return fallback;
  return {
    name: input.name || fallback.name,
    company: input.company || undefined,
    street1: input.street1 || '',
    street2: input.street2 || undefined,
    city: input.city || '',
    state: input.state || '',
    postalCode: input.postalCode || '',
    country: input.country || 'US',
    phone: input.phone || undefined,
  };
}

function getRefundEstimate(carrierCode: string | null): string {
  if (carrierCode === 'stamps_com' || carrierCode === 'usps') return '2-5 days (USPS)';
  if (carrierCode === 'fedex') return '3-7 days (FedEx)';
  if (carrierCode === 'ups') return '3-7 days (UPS)';
  return '2-7 days';
}

// v2-parity: credential resolution now lives in src/lib/shipstation/credentials.ts
// and includes the rate_source_client_id fallback from v2 (which the previous
// inline helper ignored — keyed clients with a rate-source fallback would
// silently fail).
import { loadClientCredentials as loadClientCredentialsImpl } from '../lib/shipstation/credentials';

async function loadClientCredentials(clientId: number | null | undefined): Promise<{
  apiKeyV2: string | null;
  apiKey: string | null;
  apiSecret: string | null;
}> {
  return loadClientCredentialsImpl(clientId);
}

// ── Label lookup ──────────────────────────────────────────────────────────────

export async function lookupLabel(lookup: string) {
  const asNum = Number(lookup);
  const rows = await db
    .select()
    .from(shipments)
    .where(
      Number.isFinite(asNum)
        ? or(eq(shipments.orderId, asNum), eq(shipments.id, asNum))
        : eq(shipments.trackingNumber, lookup)
    )
    .orderBy(desc(shipments.createdAt))
    .limit(10);
  return rows;
}

// ── V2-parity label orchestration ─────────────────────────────────────────────

async function findActiveLabelForOrder(orderId: number) {
  const [row] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.orderId, orderId), eq(shipments.voided, false), eq(shipments.isReturn, false)))
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  return row ?? null;
}

async function loadOrderRecord(orderId: number) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return order ?? null;
}

async function loadOrderDimsOverride(orderId: number) {
  const [row] = await db
    .select()
    .from(orderOverrides)
    .where(eq(orderOverrides.orderId, orderId))
    .limit(1);
  return row ?? null;
}

function serviceCodeFitsPackage(_: string): string {
  return 'package';
}

async function persistCreatedLabel(args: {
  created: CreatedExternalLabel;
  orderId: number;
  orderNumber: string | null;
  clientId: number | null;
  effectiveWeightOz: number;
  length: number | null;
  width: number | null;
  height: number | null;
  selectedPackageId: string | null;
  source: string;
}): Promise<number> {
  const { created } = args;
  const createdAt = new Date();
  const shipDate = created.shipDate ? new Date(created.shipDate) : createdAt;
  const [row] = await db
    .insert(shipments)
    .values({
      orderId: args.orderId,
      clientId: args.clientId,
      orderNumber: args.orderNumber,
      carrierCode: created.carrierCode,
      serviceCode: created.serviceCode,
      trackingNumber: created.trackingNumber,
      shipDate,
      createDate: createdAt,
      weightOz: args.effectiveWeightOz,
      dimsL: args.length,
      dimsW: args.width,
      dimsH: args.height,
      cost: created.cost.toFixed(2),
      labelUrl: created.labelUrl,
      labelCreatedAt: createdAt,
      labelFormat: created.labelFormat ?? 'pdf',
      labelCarrier: created.carrierCode,
      labelService: created.serviceCode,
      labelTracking: created.trackingNumber,
      labelCost: created.cost.toFixed(2),
      labelShipDate: shipDate,
      labelShipmentId: created.shipmentId || null,
      shipstationLabelId: created.labelId,
      labelProvider: created.providerAccountId,
      providerAccountId: created.providerAccountId,
      selectedPackageId: args.selectedPackageId,
      selectedRateJson: {
        providerAccountId: created.providerAccountId,
        shippingProviderId: created.providerAccountId,
        carrierCode: created.carrierCode,
        serviceCode: created.serviceCode,
        serviceName: created.serviceCode,
        cost: created.cost,
        shipmentCost: created.cost,
        otherCost: 0,
      },
      voided: created.voided,
      source: args.source,
      isReturn: false,
    })
    .returning({ id: shipments.id });
  if (!row) throw new Error('Failed to persist shipment row');
  return row.id;
}

async function markOrderShipped(
  orderId: number,
  trackingNumber: string | null,
  options: { cleanupQueue?: boolean } = {}
): Promise<void> {
  void options;
  await db
    .update(orders)
    .set({ orderStatus: 'shipped', updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  if (trackingNumber) {
    await db
      .insert(orderOverrides)
      .values({ orderId, trackingNumber, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: orderOverrides.orderId,
        set: { trackingNumber, updatedAt: new Date() },
      });
  }

  // Print Queue persistence: shipped status means a label exists, not that an
  // operator physically printed it. Queue entries persist until explicit
  // operator action confirms printed or removes them.

}

async function recordFulfillmentDeductions(args: {
  order: typeof orders.$inferSelect;
  shipmentId: number;
  packageId?: number | string | null;
  source: string;
  timer?: LabelTimer;
}) {
  try {
    const deductPackage = () => deductPackageForShipment({
      packageId: args.packageId ?? null,
      shipmentId: args.shipmentId,
      orderId: args.order.id,
      orderNumber: args.order.orderNumber,
    });
    const deductInventory = () => deductInventoryForOrder(args.order, {
      shipmentId: args.shipmentId,
      source: args.source,
    });

    if (args.timer) {
      await args.timer.task('package stock deduction', deductPackage);
      await args.timer.task('inventory ledger writes', deductInventory);
    } else {
      await deductPackage();
      await deductInventory();
    }
  } catch (err) {
    console.warn('[labels] fulfillment deduction failed:', err);
  }
}

/**
 * Create a label (v2-parity). Supports offline testLabel mode (generates a
 * mock PDF with no ShipStation interaction) and real ShipStation creation.
 */
export async function createLabelV2(body: CreateLabelInputDto): Promise<CreateLabelResponseDto> {
  if (!body.orderId || !body.serviceCode) {
    throw new Error('orderId and serviceCode required');
  }

  const timer = createLabelTimer(body.orderId);
  await timer.task('fulfillment schema readiness', () => ensureFulfillmentSchema());
  const order = await timer.task('order load', () => loadOrderRecord(body.orderId));
  if (!order) throw new Error('Order not found');
  if (order.orderStatus === 'shipped' || order.orderStatus === 'cancelled') {
    throw new Error(`Cannot create label for ${order.orderStatus} order`);
  }

  // Resolve clientId — prefer order.clientId, fall back to mapping order.storeId
  // through the clients.storeIds array (v2 parity for legacy orders whose
  // clientId was never backfilled).
  let clientId = order.clientId;
  if (!clientId && order.storeId != null) {
    const [match] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(sql`${clients.storeIds} @> ${[order.storeId]}::integer[]`)
      .limit(1);
    clientId = match?.id ?? null;
  }
  // Hard guard: any order under an isTest client is forced into offline-mock
  // mode regardless of what the UI sent. Prevents a test row from ever
  // spending real postage.
  if (clientId) {
    const [cli] = await db
      .select({ isTest: clients.isTest })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (cli?.isTest) {
      body = { ...body, testLabel: true };
    }
  }
  if (clientId && !body.testLabel) checkLabelRateLimit(clientId);

  const existing = await timer.task('existing-label check', () => findActiveLabelForOrder(order.id));
  if (existing) {
    const err = new Error('Label already exists for this order') as Error & {
      details?: Record<string, unknown>;
    };
    err.details = {
      shipmentId: existing.id,
      trackingNumber: existing.trackingNumber,
      labelUrl: existing.labelUrl,
    };
    throw err;
  }

  const overrides = await loadOrderDimsOverride(order.id);
  const effectiveWeightOz = Number(body.weightOz ?? overrides?.rateWeightOz ?? order.weightOz ?? (body.testLabel ? 1 : 0));
  if (!effectiveWeightOz) throw new Error('Order weight required to create label');

  const length = Number(body.length ?? overrides?.rateDimsL ?? 0) || null;
  const width = Number(body.width ?? overrides?.rateDimsW ?? 0) || null;
  const height = Number(body.height ?? overrides?.rateDimsH ?? 0) || null;

  const fallbackShipTo = orderShipToFromRaw(order);
  const shipTo = mergeAddress(body.shipTo, fallbackShipTo);
  let shipFrom: ShipstationAddressInput;
  if (body.shipFrom?.street1) {
    shipFrom = mergeAddress(body.shipFrom, defaultShipFromAddress());
  } else {
    try {
      const fromLoc = await getDefaultShipFrom();
      shipFrom = {
        name: fromLoc.name,
        company: fromLoc.company_name,
        street1: fromLoc.address_line1,
        street2: fromLoc.address_line2,
        city: fromLoc.city_locality,
        state: fromLoc.state_province,
        postalCode: fromLoc.postal_code,
        country: fromLoc.country_code,
        phone: fromLoc.phone,
      };
    } catch {
      shipFrom = defaultShipFromAddress();
    }
  }

  // Resolve which package this shipment is consuming so its stock_qty is
  // decremented correctly. Used for both the test-mode and real-postage paths.
  const resolvedPackageId = await resolveLabelPackageId({
    customPackageId: body.customPackageId,
    length,
    width,
    height,
  });

  // ── Offline test mode ───────────────────────────────────────────────────────
  if (body.testLabel === true) {
    const fakeShipmentId = generateFakeShipmentId();
    const fakeTracking = generateFakeTrackingNumber();
    const shipDate = new Date().toISOString().slice(0, 10);
    // Absolute URL so window.open from the Vercel-hosted UI resolves to the
    // API host, not the frontend origin. Falls back to relative path in dev
    // when PUBLIC_API_URL isn't set (Vite proxies /labels/ to localhost:3000).
    const apiBase = (process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '');
    const mockLabelUrlBase = apiBase
      ? `${apiBase}/labels/mock/${fakeShipmentId}`
      : `/labels/mock/${fakeShipmentId}`;
    const mockLabelUrl = addMockLabelSignature(mockLabelUrlBase, fakeShipmentId);

    const mockData: MockLabelData = {
      shipmentId: fakeShipmentId,
      orderNumber: order.orderNumber ?? null,
      trackingNumber: fakeTracking,
      serviceLabel: serviceCodeToLabel(body.serviceCode),
      weightOz: effectiveWeightOz,
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
      console.error('[mock-label] PDF generation failed:', (err as Error).message);
    }
    saveMockLabel(fakeShipmentId, { ...mockData, pdfBase64 });

    const createdAt = new Date();
    await db
      .insert(shipments)
      .values({
        orderId: order.id,
        clientId,
        orderNumber: order.orderNumber,
        carrierCode: body.carrierCode ?? 'stamps_com',
        serviceCode: body.serviceCode,
        trackingNumber: fakeTracking,
        shipDate: createdAt,
        createDate: createdAt,
        weightOz: effectiveWeightOz,
        dimsL: length,
        dimsW: width,
        dimsH: height,
        cost: '0.00',
        labelUrl: mockLabelUrl,
        labelCreatedAt: createdAt,
        labelFormat: 'html',
        labelCarrier: body.carrierCode ?? 'stamps_com',
        labelService: body.serviceCode,
        labelTracking: fakeTracking,
        labelCost: '0.00',
        labelShipDate: createdAt,
        labelShipmentId: fakeShipmentId,
        selectedPackageId: resolvedPackageId != null ? String(resolvedPackageId) : null,
        source: 'test_offline',
        voided: false,
        isReturn: false,
      });

    await timer.task('markOrderShipped', () => markOrderShipped(order.id, fakeTracking, { cleanupQueue: false }));
    timer.background('inventory/package deduction', () => recordFulfillmentDeductions({
      order,
      shipmentId: fakeShipmentId,
      packageId: resolvedPackageId,
      source: 'test_label',
      timer,
    }));

    timer.done('response ready');
    return {
      shipmentId: fakeShipmentId,
      trackingNumber: fakeTracking,
      labelUrl: mockLabelUrl,
      cost: 0,
      voided: false,
      orderStatus: 'shipped',
      apiVersion: 'v2',
    };
  }

  // ── Real ShipStation flow ───────────────────────────────────────────────────
  const creds = await loadClientCredentials(clientId);
  const apiKeyV2 = creds.apiKeyV2 ?? undefined;
  if (!body.shippingProviderId) {
    throw new Error('shippingProviderId required for v2 label creation');
  }

  const created = await timer.task('ShipStation createLabel connector', () => carrierConnectors.shipstation.createLabel({
    apiKeyV2,
    carrierId: `se-${body.shippingProviderId}`,
    serviceCode: body.serviceCode,
    packageCode: body.packageCode || serviceCodeFitsPackage(body.serviceCode),
    weightOz: effectiveWeightOz,
    length,
    width,
    height,
    shipTo,
    shipFrom,
    confirmation: body.confirmation ?? null,
    ssOrderId: order.id,
    orderNumber: order.orderNumber ?? null,
    testLabel: false,
  }));

  const localShipmentId = await timer.task('persistCreatedLabel', () => persistCreatedLabel({
    created,
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    clientId: clientId ?? null,
    effectiveWeightOz,
    length,
    width,
    height,
    selectedPackageId: body.customPackageId ? String(body.customPackageId) : null,
    source: 'prepship_v2',
  }));

  await timer.task('markOrderShipped', () => markOrderShipped(order.id, created.trackingNumber, { cleanupQueue: false }));
  timer.background('inventory/package deduction', () => recordFulfillmentDeductions({
    order,
    shipmentId: localShipmentId,
    packageId: resolvedPackageId,
    source: 'label',
    timer,
  }));
  // Queue marketplace confirmation separately from label purchase. The label
  // response stays fast, while fulfillment_outbox owns retries and failure state.
  const confirmationProvider = confirmationProviderForOrder(order);
  await timer.task('enqueue marketplace confirmation', () => enqueueShipmentConfirmation({
    order: {
      id: order.id,
      externalOrderId: order.externalOrderId,
      clientId,
      orderNumber: order.orderNumber ?? null,
    },
    shipmentId: localShipmentId,
    trackingNumber: created.trackingNumber,
    carrierCode: created.carrierCode,
    shipDate: created.shipDate,
    confirmationProvider,
    payload: marketplaceConfirmationPayload(order, created, confirmationProvider),
  }));

  timer.background('marketplace confirmation outbox', () =>
    processFulfillmentOutboxOnce({ orderId: order.id, limit: 5 }).then(() => undefined)
  );

  timer.done('response ready');
  return {
    shipmentId: localShipmentId,
    trackingNumber: created.trackingNumber,
    labelUrl: created.labelUrl,
    cost: created.cost,
    voided: created.voided,
    orderStatus: 'shipped',
    apiVersion: 'v2',
  };
}

export async function createBatchV2(body: CreateBatchLabelInputDto): Promise<CreateBatchLabelResponseDto> {
  const created: BatchLabelResultItem[] = [];
  const failed: BatchLabelResultItem[] = [];

  await withConcurrency(
    body.orderIds,
    async (orderId) => {
      try {
        const result = await createLabelV2({
          orderId,
          serviceCode: body.serviceCode,
          carrierCode: body.carrierCode,
          packageCode: body.packageCode,
          confirmation: body.confirmation,
          testLabel: body.testLabel,
          shippingProviderId: body.shippingProviderId,
        });
        created.push({
          orderId,
          success: true,
          shipmentId: result.shipmentId,
          trackingNumber: result.trackingNumber,
          cost: result.cost,
        });
      } catch (err) {
        failed.push({
          orderId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    5
  );

  return {
    created,
    failed,
    summary: {
      total: body.orderIds.length,
      created: created.length,
      failed: failed.length,
    },
  };
}

// ── Void / Return / Retrieve ──────────────────────────────────────────────────

export async function voidLabelV2(shipmentId: number): Promise<VoidLabelResponseDto> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(or(eq(shipments.id, shipmentId), eq(shipments.labelShipmentId, shipmentId)))
    .limit(1);
  if (!row) throw new Error('Shipment not found');
  if (row.voided) throw new Error('Label already voided');

  // Double guard: honor the explicit test_offline source marker AND verify
  // the shipment's client isn't flagged is_test (in case a test row was
  // somehow persisted with a real labelShipmentId).
  let clientIsTest = false;
  if (row.clientId) {
    const [cli] = await db
      .select({ isTest: clients.isTest })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1);
    clientIsTest = Boolean(cli?.isTest);
  }
  if (row.source !== 'test_offline' && !clientIsTest && row.labelShipmentId) {
    const creds = await loadClientCredentials(row.clientId);
    try {
      await ssVoidShipment(row.labelShipmentId, creds.apiKeyV2 ?? undefined);
    } catch (err) {
      // Surface the SS error but still record the local void — parity with v2 is to fail hard.
      throw err;
    }
  }

  const now = new Date();
  await db
    .update(shipments)
    .set({ voided: true, updatedAt: now })
    .where(eq(shipments.id, row.id));

  // CP-057: a voided RETURN label must also advance its purchase intent, or the intent
  // stays at `completed` and UNIQUE (return_id) forbids buying a replacement — the return
  // is stranded with a dead label. `shipments.voided` above remains canonical for whether
  // postage was voided; this is only the derived lifecycle marker written from that event.
  //
  // Ordered deliberately: the provider void already succeeded (it throws above otherwise)
  // and the local void is committed, so the intent can only advance behind a real,
  // confirmed void. A failure here must NOT undo a void that already happened at the
  // provider, so it is logged rather than thrown: the shipment is voided either way, and a
  // stranded intent is recoverable while a phantom un-void is not.
  try {
    const advancedIntentId = await markReturnLabelPurchaseVoidedForShipment(row.id, {
      note: `Return label voided for shipment ${row.id}`,
      actor: 'labels.voidLabelV2',
    });
    if (advancedIntentId != null) {
      console.log('[labels] CP-057 return purchase intent voided', {
        shipmentId: row.id,
        intentId: advancedIntentId,
      });
    }
  } catch (err) {
    console.error(
      '[labels] CP-057 return purchase intent could not be advanced after void:',
      err instanceof Error ? err.message : err,
    );
  }

  // Reset the order back to awaiting_shipment so a new label can be created.
  if (row.orderId) {
    await db
      .update(orders)
      .set({ orderStatus: 'awaiting_shipment', updatedAt: now })
      .where(eq(orders.id, row.orderId));
  }

  return {
    success: true,
    shipmentId: row.id,
    orderNumber: row.orderNumber,
    voided: true,
    voidedAt: now.toISOString(),
    trackingNumber: row.trackingNumber,
    refundAmount: row.labelCost ? Number(row.labelCost) : null,
    refundInitiated: true,
    refundEstimate: getRefundEstimate(row.carrierCode),
    note: 'Order status reset to "Awaiting Shipment"; you can create a new label.',
  };
}

export async function createReturnLabelV2(
  shipmentId: number,
  body: { reason?: string } = {}
): Promise<ReturnLabelResponseDto> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(or(eq(shipments.id, shipmentId), eq(shipments.labelShipmentId, shipmentId)))
    .limit(1);
  if (!row) throw new Error('Shipment not found');
  if (!row.labelShipmentId) throw new Error('Cannot create return — no ShipStation shipment id on record');

  // Block real-postage returns for test-client shipments. createLabelV2
  // forces testLabel=true for isTest clients, but returns go through a
  // separate SS endpoint — without this check a test shipment with a real
  // labelShipmentId (edge case) would burn real postage.
  if (row.clientId) {
    const [cli] = await db
      .select({ isTest: clients.isTest })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1);
    if (cli?.isTest) {
      throw new Error('Cannot create return label for a test-client shipment');
    }
  }

  const creds = await loadClientCredentials(row.clientId);
  const reason = body.reason || 'Customer Return';
  const result = await ssCreateReturnLabel(row.labelShipmentId, reason, creds.apiKeyV2 ?? undefined);
  const now = new Date();

  const [newShipment] = await db
    .insert(shipments)
    .values({
      orderId: row.orderId,
      clientId: row.clientId,
      orderNumber: row.orderNumber,
      carrierCode: row.carrierCode,
      serviceCode: row.serviceCode,
      trackingNumber: result.returnTrackingNumber,
      shipDate: now,
      createDate: now,
      cost: result.cost.toFixed(2),
      labelUrl: result.labelUrl,
      labelCreatedAt: now,
      labelFormat: 'pdf',
      labelCarrier: row.carrierCode,
      labelService: row.serviceCode,
      labelTracking: result.returnTrackingNumber,
      labelCost: result.cost.toFixed(2),
      labelShipDate: now,
      labelShipmentId: result.returnShipmentId,
      source: 'prepship_v2',
      voided: false,
      isReturn: true,
      returnForShipmentId: row.id,
      returnReason: reason,
    })
    .returning({ id: shipments.id });

  // v2-parity: also record the return in the dedicated return_labels table.
  // Best-effort — failures here don't roll back the shipments insert since
  // the canonical source is shipments.isReturn + returnForShipmentId.
  try {
    const { returnLabels } = await import('../db/schema/return-labels');
    await db.insert(returnLabels).values({
      shipmentId: row.id,
      returnShipmentId: newShipment?.id ?? null,
      returnTrackingNumber: result.returnTrackingNumber,
      reason,
    });
  } catch (err) {
    console.warn('[labels] return_labels mirror insert failed:', err);
  }

  return {
    success: true,
    shipmentId: row.id,
    orderNumber: row.orderNumber,
    returnTrackingNumber: result.returnTrackingNumber,
    returnShipmentId: result.returnShipmentId,
    cost: result.cost,
    reason,
    createdAt: now.toISOString(),
  };
}

export async function retrieveLabelV2(
  lookup: number | string,
  fresh = false
): Promise<RetrieveLabelResponseDto> {
  const asNum = typeof lookup === 'number' ? lookup : Number(lookup);
  const isNumeric = Number.isFinite(asNum);

  const [row] = await db
    .select()
    .from(shipments)
    .where(
      and(
        eq(shipments.voided, false),
        isNumeric
          ? or(
              eq(shipments.orderId, asNum),
              eq(shipments.id, asNum),
              eq(shipments.labelShipmentId, asNum)
            )
          : eq(shipments.trackingNumber, String(lookup))
      )
    )
    .orderBy(desc(shipments.createdAt))
    .limit(1);

  if (!row) throw new Error('No active label found for this order');

  let labelUrl = row.labelUrl;
  if (fresh || !labelUrl) {
    const freshUrl = await findFreshLabelUrl(row);
    if (freshUrl && freshUrl !== labelUrl) {
      await db.update(shipments).set({ labelUrl: freshUrl, updatedAt: new Date() }).where(eq(shipments.id, row.id));
      labelUrl = freshUrl;
    }
  }

  if (!labelUrl) {
    if (row.source === 'shipstation') {
      throw new Error(
        `Label was created in ShipStation before label tracking was enabled. Access it directly in ShipStation or use tracking number ${row.trackingNumber || 'N/A'}`
      );
    }
    throw new Error('Label URL not available. The label may have been voided or deleted.');
  }

  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    shipmentId: row.id,
    trackingNumber: row.trackingNumber,
    labelUrl,
    createdAt: row.labelCreatedAt ? row.labelCreatedAt.toISOString() : null,
    carrier: row.carrierCode || 'unknown',
    service: row.serviceCode || 'unknown',
    cost: row.labelCost ? Number(row.labelCost) : 0,
  };
}

async function findFreshLabelUrl(row: {
  clientId: number | null;
  labelShipmentId: number | null;
  trackingNumber: string | null;
  source: string | null;
}): Promise<string | null> {
  const creds = await loadClientCredentials(row.clientId);
  const labels = await ssListRecentLabels(creds.apiKeyV2 ?? undefined);
  if (row.labelShipmentId) {
    const byShipment = labels.find((entry) => entry.shipmentId === row.labelShipmentId);
    if (byShipment?.labelUrl) return byShipment.labelUrl;
  }
  if (row.trackingNumber) {
    const byTracking = labels.find((entry) => entry.trackingNumber === row.trackingNumber);
    if (byTracking?.labelUrl) return byTracking.labelUrl;
  }
  if (creds.apiKey && creds.apiSecret && row.labelShipmentId) {
    const details = await ssGetShipmentV1(row.labelShipmentId, {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });
    if (details?.labelUrl) return details.labelUrl;
  }
  return null;
}

export { generateMockLabelHtml } from './mock-label-generator';
export type { MockLabelData } from './mock-label-generator';

// ── Carrier nickname resolver ─────────────────────────────────────────────────
// Moved to ./labels-carrier-nickname. Re-exported for existing importers
// (services/billing.ts).
export { resolveCarrierNickname } from './labels-carrier-nickname';

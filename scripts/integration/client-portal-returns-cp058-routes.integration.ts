/* CP-057/058 public-route conflict and private-object compensation proof.
 *
 * Runs real Hono return handlers and canonical services against a throwaway
 * Postgres. Every network request is blocked, and Supabase Storage is replaced
 * with an in-memory private-object fixture.
 */
import { File as NodeFile } from 'node:buffer';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.RETURNS_LIVE_LABELS = 'true';
process.env.SHIPSTATION_API_KEY_V2 = 'cp058-route-test-key';

if (!('WebSocket' in globalThis)) {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: class TestWebSocket {},
    configurable: true,
  });
}
if (!('File' in globalThis)) {
  Object.defineProperty(globalThis, 'File', {
    value: NodeFile,
    configurable: true,
  });
}

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  networkCalls += 1;
  throw new Error(`CP-058 route integration blocked unexpected network request: ${String(input)}`);
}) as typeof fetch;

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { registerReturnActionRoutes } = await import('../../src/routes/client-portal/returns/actions');
const { supabaseAdmin } = await import('../../src/lib/supabase');

let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message} (got ${String(actual)}, want ${String(expected)})`);
}

type Fixture = {
  clientId: number;
  orderId: number;
  returnId: number;
};

type ConflictBody = {
  error?: unknown;
  code?: unknown;
};

type StorageError = { message: string };
type MockStorage = {
  from: (bucket: string) => {
    upload: (
      path: string,
      body: ArrayBuffer | Uint8Array | Blob,
      options: Record<string, unknown>,
    ) => Promise<{ data: { path: string }; error: null }>;
    remove: (
      paths: string[],
    ) => Promise<{ data: { name: string }[] | null; error: StorageError | null }>;
  };
};

function appFor(clientId: number): Hono {
  const routes = new Hono();
  registerReturnActionRoutes(routes);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'cp058-route-user' as never);
    c.set('email' as never, 'cp058-route@example.test' as never);
    c.set('role' as never, 'client_user' as never);
    c.set('permissions' as never, [] as never);
    c.set('clientIds' as never, [clientId] as never);
    c.set('storeIds' as never, [] as never);
    await next();
  });
  app.route('/', routes);
  return app;
}

function jsonRequest(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function pdfRequest(): RequestInit {
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])], 'return-label.pdf', {
      type: 'application/pdf',
      lastModified: Date.parse('2026-08-20T00:00:00.000Z'),
    }),
  );
  return { method: 'POST', body: form };
}

async function reset(): Promise<void> {
  await db.execute(sql`
    truncate table
      return_label_purchase_intents,
      return_activity_events,
      return_labels,
      client_portal_audit_logs,
      returns,
      shipments,
      rate_cache,
      billing_config,
      orders,
      clients
    restart identity cascade
  `);
  networkCalls = 0;
}

async function seedBase(): Promise<Fixture> {
  const [client] = await db
    .insert(schema.clients)
    .values({ name: 'CP-058 Route Client', isTest: false })
    .returning();
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: 'CP058-ROUTE-ORDER',
      orderStatus: 'shipped',
      clientId: client!.id,
      shipToName: 'CP-058 Customer',
      shipToCity: 'Los Angeles',
      shipToState: 'CA',
      shipToPostalCode: '90001',
      raw: {
        shipTo: {
          name: 'CP-058 Customer',
          street1: '58 Test Street',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          country: 'US',
        },
      },
    })
    .returning();
  await db.insert(schema.shipments).values({
    orderId: order!.id,
    clientId: client!.id,
    orderNumber: order!.orderNumber,
    trackingNumber: 'OUTBOUND-CP058-ROUTE',
    weightOz: 16,
    dimsL: 10,
    dimsW: 8,
    dimsH: 4,
    selectedPackageId: 'package',
    voided: false,
    isReturn: false,
    source: 'cp058_route_fixture',
  });
  const [returnRow] = await db
    .insert(schema.returns)
    .values({
      orderId: order!.id,
      clientId: client!.id,
      returnReference: 'CP058-ROUTE-ORDER-RETURN',
      status: 'requested',
      initiatedBy: 'client',
      reason: 'CP-058 route integration fixture',
    })
    .returning();
  return {
    clientId: client!.id,
    orderId: order!.id,
    returnId: returnRow!.id,
  };
}

async function seedOwnedPurchaseIntent(): Promise<Fixture> {
  const fixture = await seedBase();
  const now = new Date();
  await db.insert(schema.returnLabelPurchaseIntents).values({
    returnId: fixture.returnId,
    state: 'purchasing',
    providerReferenceKey: `cp058-route-owned-${fixture.returnId}`,
    leaseToken: `cp058-route-lease-${fixture.returnId}`,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    lastAttemptAt: now,
  });
  return fixture;
}

async function seedExternalPdf(): Promise<Fixture & { externalShipmentId: number }> {
  const fixture = await seedBase();
  const [shipment] = await db
    .insert(schema.shipments)
    .values({
      orderId: fixture.orderId,
      clientId: fixture.clientId,
      orderNumber: 'CP058-ROUTE-ORDER',
      trackingNumber: 'EXTERNAL-CP058-ROUTE',
      cost: '6.58',
      isReturn: true,
      voided: false,
      source: 'external_return_label',
    })
    .returning();
  await db
    .update(schema.returns)
    .set({
      returnShipmentId: shipment!.id,
      status: 'label_created',
      updatedAt: new Date(),
    })
    .where(eq(schema.returns.id, fixture.returnId));
  return { ...fixture, externalShipmentId: shipment!.id };
}

async function replaceExternalOwner(
  fixture: Fixture & { externalShipmentId: number },
): Promise<number> {
  await db
    .update(schema.shipments)
    .set({ voided: true, updatedAt: new Date() })
    .where(eq(schema.shipments.id, fixture.externalShipmentId));
  const [replacement] = await db
    .insert(schema.shipments)
    .values({
      orderId: fixture.orderId,
      clientId: fixture.clientId,
      orderNumber: 'CP058-ROUTE-ORDER',
      trackingNumber: 'EXTERNAL-CP058-REPLACEMENT',
      cost: '7.58',
      isReturn: true,
      voided: false,
      source: 'external_return_label',
    })
    .returning();
  await db
    .update(schema.returns)
    .set({ returnShipmentId: replacement!.id, updatedAt: new Date() })
    .where(eq(schema.returns.id, fixture.returnId));
  return replacement!.id;
}

async function responseBody(response: Response): Promise<ConflictBody> {
  return response.json() as Promise<ConflictBody>;
}

async function returnShipmentCount(orderId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.isReturn, true)));
  return Number(row?.count ?? 0);
}

async function successRecordCount(): Promise<number> {
  const [audit] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientPortalAuditLogs);
  const [activity] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.returnActivityEvents);
  return Number(audit?.count ?? 0) + Number(activity?.count ?? 0);
}

async function routeConflictScenario(): Promise<void> {
  console.log('\nCP-057/058 route conflicts - exact public 409 contract');
  await reset();
  const fixture = await seedOwnedPurchaseIntent();
  const app = appFor(fixture.clientId);

  const labelResponse = await app.request(`/returns/${fixture.returnId}/label`, {
    method: 'POST',
  });
  const labelBody = await responseBody(labelResponse);
  equal(labelResponse.status, 409, 'purchased-label loser returns HTTP 409');
  equal(
    labelBody.code,
    'label_assignment_in_progress',
    'purchased-label loser returns the stable conflict code',
  );
  equal(
    labelBody.error,
    'Return label purchase is being reconciled. Please retry shortly.',
    'purchased-label loser keeps the typed redaction-safe message',
  );
  equal(
    Object.keys(labelBody).sort().join(','),
    'code,error',
    'purchased-label loser exposes only the error and stable code',
  );

  const externalResponse = await app.request(
    `/returns/${fixture.returnId}/external-tracking`,
    jsonRequest({ trackingNumber: '1ZCP058ROUTE000001', amountPaid: '6.58' }),
  );
  const externalBody = await responseBody(externalResponse);
  equal(externalResponse.status, 409, 'external-tracking loser returns HTTP 409');
  equal(
    externalBody.code,
    'label_assignment_in_progress',
    'external-tracking loser returns the stable conflict code',
  );
  equal(
    externalBody.error,
    'Another label assignment already owns this return. Refresh and try again.',
    'external-tracking loser keeps the typed redaction-safe message',
  );
  equal(
    Object.keys(externalBody).sort().join(','),
    'code,error',
    'external-tracking loser exposes only the error and stable code',
  );
  equal(
    await returnShipmentCount(fixture.orderId),
    0,
    'both losing public requests leave zero orphan return shipments',
  );
  equal(networkCalls, 0, 'both losing public requests make zero provider or storage network calls');
  equal(await successRecordCount(), 0, 'neither losing request records a success audit or activity');
}

async function pdfCompensationScenario(cleanupFails: boolean): Promise<void> {
  console.log(
    cleanupFails
      ? '\nCP-058 PDF compensation - private deletion failure'
      : '\nCP-058 PDF compensation - successful private deletion',
  );
  await reset();
  const fixture = await seedExternalPdf();
  const app = appFor(fixture.clientId);
  const storage = supabaseAdmin.storage as unknown as MockStorage;
  const originalFrom = storage.from;
  const privateObjects = new Set<string>();
  const removedPaths: string[] = [];
  const buckets: string[] = [];
  let replacementShipmentId: number | null = null;
  let uploadCalls = 0;
  let removeCalls = 0;
  const originalConsoleError = console.error;
  const cleanupLogs: string[] = [];

  storage.from = (bucket) => ({
    upload: async (path) => {
      buckets.push(bucket);
      uploadCalls += 1;
      privateObjects.add(path);
      replacementShipmentId = await replaceExternalOwner(fixture);
      return { data: { path }, error: null };
    },
    remove: async (paths) => {
      buckets.push(bucket);
      removeCalls += 1;
      removedPaths.push(...paths);
      if (cleanupFails) {
        return { data: null, error: { message: 'fixture private cleanup failed' } };
      }
      for (const path of paths) privateObjects.delete(path);
      return { data: paths.map((name) => ({ name })), error: null };
    },
  });
  console.error = (...args: unknown[]) => {
    cleanupLogs.push(args.map((value) => String(value)).join(' '));
  };

  let response: Response;
  try {
    response = await app.request(
      `/returns/${fixture.returnId}/external-label-pdf`,
      pdfRequest(),
    );
  } finally {
    storage.from = originalFrom;
    console.error = originalConsoleError;
  }

  const body = await responseBody(response);
  equal(response.status, 409, 'race-lost PDF request returns HTTP 409');
  equal(body.code, 'label_assignment_in_progress', 'race-lost PDF returns the stable conflict code');
  equal(
    body.error,
    'Another label assignment already owns this return. Refresh and try again.',
    'cleanup outcome does not replace the original safe ownership error',
  );
  equal(uploadCalls, 1, 'the private object fixture records one completed upload');
  equal(removeCalls, 1, 'lost ownership executes exactly one compensating deletion');
  equal(removedPaths.length, 1, 'compensating deletion targets exactly one object');
  check(
    removedPaths[0]?.startsWith(`returns/${fixture.returnId}/external-label/`) === true,
    'compensating deletion targets the just-uploaded return object',
  );
  check(buckets.length === 2 && new Set(buckets).size === 1, 'upload and cleanup use one private bucket');
  equal(networkCalls, 0, 'PDF compensation makes zero real storage or provider network calls');

  const shipmentIds = [fixture.externalShipmentId, replacementShipmentId].filter(
    (value): value is number => value != null,
  );
  const rows = await db
    .select({ id: schema.shipments.id, labelUrl: schema.shipments.labelUrl })
    .from(schema.shipments)
    .where(inArray(schema.shipments.id, shipmentIds));
  check(rows.every((row) => row.labelUrl == null), 'lost ownership persists no stale PDF path');

  const serializedBody = JSON.stringify(body);
  check(!serializedBody.includes('fixture private cleanup failed'), 'cleanup details are absent from the response');
  check(!serializedBody.includes(String(buckets[0])), 'the private bucket name is absent from the response');
  check(!serializedBody.includes(removedPaths[0] ?? ''), 'the private object path is absent from the response');

  if (cleanupFails) {
    equal(privateObjects.size, 1, 'failed cleanup leaves one private, unreferenced object');
    check(
      cleanupLogs.some((line) => line.includes('external label pdf cleanup failed')),
      'cleanup failure is recorded for operator follow-up',
    );
  } else {
    equal(privateObjects.size, 0, 'successful compensation removes the private object');
    equal(cleanupLogs.length, 0, 'successful compensation emits no cleanup error');
  }
}

async function main(): Promise<void> {
  await routeConflictScenario();
  await pdfCompensationScenario(false);
  await pdfCompensationScenario(true);
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\nPASS CP-057/058 public-route and storage-compensation integration suite.\n'
      : `\nFAIL ${failures} CP-057/058 route/storage assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\nFAIL CP-057/058 public-route and storage-compensation suite errored:',
    error instanceof Error ? error.stack : error,
  );
} finally {
  globalThis.fetch = originalFetch;
  try {
    await reset();
  } catch {
    // Best-effort cleanup only; setupTestEnv already guarantees a throwaway DB.
  }
  await pgClient.end({ timeout: 2 });
  process.exit(exitCode);
}

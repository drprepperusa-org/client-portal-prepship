/* CP-045 return-inspection authority integration suite.
 *
 * Runs the real receiving routes against a throwaway Postgres. Supabase media
 * storage is replaced with an in-memory upload fixture, so this cannot touch
 * production data or object storage.
 */
import { File as NodeFile } from 'node:buffer';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();

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

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { registerReturnReceivingRoutes } = await import(
  '../../src/routes/client-portal/returns/receiving'
);
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

type TestActor = {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  clientIds: number[];
  storeIds: number[];
};

function appFor(actor: TestActor): Hono {
  const route = new Hono();
  registerReturnReceivingRoutes(route);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, actor.userId as never);
    c.set('email' as never, actor.email as never);
    c.set('role' as never, actor.role as never);
    c.set('permissions' as never, actor.permissions as never);
    c.set('clientIds' as never, actor.clientIds as never);
    c.set('storeIds' as never, actor.storeIds as never);
    await next();
  });
  app.route('/', route);
  return app;
}

function jsonRequest(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function mediaRequest(): RequestInit {
  const form = new FormData();
  form.set('mediaType', 'photo');
  form.set(
    'file',
    new File([new Uint8Array([137, 80, 78, 71])], 'cp045-proof.png', {
      type: 'image/png',
      lastModified: Date.parse('2026-07-17T00:00:00.000Z'),
    }),
  );
  return { method: 'POST', body: form };
}

async function reset(): Promise<void> {
  await db.execute(sql`
    truncate table
      return_inspection_media,
      return_inspections,
      client_portal_audit_logs,
      returns,
      orders,
      clients
    restart identity cascade
  `);
}

async function seed(): Promise<{
  ownClientId: number;
  clientEvidenceReturnId: number;
  operatorReturnId: number;
  otherReturnId: number;
}> {
  const [ownClient, otherClient] = await db
    .insert(schema.clients)
    .values([
      { name: 'CP-045 Own Client' },
      { name: 'CP-045 Other Client' },
    ])
    .returning();
  const [clientEvidenceOrder, operatorOrder, otherOrder] = await db
    .insert(schema.orders)
    .values([
      {
        orderNumber: 'CP045-CLIENT-EVIDENCE',
        orderStatus: 'shipped',
        clientId: ownClient!.id,
      },
      {
        orderNumber: 'CP045-OPERATOR-INSPECTION',
        orderStatus: 'shipped',
        clientId: ownClient!.id,
      },
      {
        orderNumber: 'CP045-OTHER-CLIENT',
        orderStatus: 'shipped',
        clientId: otherClient!.id,
      },
    ])
    .returning();
  const [clientEvidenceReturn, operatorReturn, otherReturn] = await db
    .insert(schema.returns)
    .values([
      {
        orderId: clientEvidenceOrder!.id,
        clientId: ownClient!.id,
        returnReference: 'CP045-CLIENT-EVIDENCE-RETURN',
        status: 'requested',
        initiatedBy: 'client',
      },
      {
        orderId: operatorOrder!.id,
        clientId: ownClient!.id,
        returnReference: 'CP045-OPERATOR-INSPECTION-RETURN',
        status: 'in_transit',
        initiatedBy: 'client',
      },
      {
        orderId: otherOrder!.id,
        clientId: otherClient!.id,
        returnReference: 'CP045-OTHER-CLIENT-RETURN',
        status: 'requested',
        initiatedBy: 'client',
      },
    ])
    .returning();
  return {
    ownClientId: ownClient!.id,
    clientEvidenceReturnId: clientEvidenceReturn!.id,
    operatorReturnId: operatorReturn!.id,
    otherReturnId: otherReturn!.id,
  };
}

type MockStorage = {
  from: (bucket: string) => {
    upload: (
      path: string,
      body: ArrayBuffer | Uint8Array | Blob,
      options: Record<string, unknown>,
    ) => Promise<{ data: { path: string }; error: null }>;
  };
};

async function main(): Promise<void> {
  await reset();
  const fixture = await seed();
  const clientActor: TestActor = {
    userId: 'cp045-client',
    email: 'client@example.test',
    role: 'client_user',
    permissions: [],
    clientIds: [fixture.ownClientId],
    storeIds: [],
  };
  const operatorActor: TestActor = {
    userId: 'cp045-operator',
    email: 'operator@example.test',
    role: 'client_user',
    permissions: ['settings:write'],
    clientIds: [fixture.ownClientId],
    storeIds: [],
  };
  const clientApp = appFor(clientActor);
  const operatorApp = appFor(operatorActor);

  console.log('\nCP-045 Group 1 - client authority is evidence-only');
  const receivingDenied = await clientApp.request('/returns/receiving');
  equal(receivingDenied.status, 403, 'client cannot open the warehouse receiving queue');

  const authoritativeDenied = await clientApp.request(
    `/returns/${fixture.clientEvidenceReturnId}/inspection`,
    jsonRequest({
      receivedAt: '2026-07-17T01:00:00.000Z',
      condition: 'damaged',
      status: 'failed',
      comments: 'Client attempted to set warehouse truth',
    }),
  );
  equal(authoritativeDenied.status, 403, 'client cannot submit receipt, condition, or status');

  let inspections = await db
    .select()
    .from(schema.returnInspections)
    .where(eq(schema.returnInspections.returnId, fixture.clientEvidenceReturnId));
  equal(inspections.length, 0, 'rejected authoritative request creates no inspection row');

  const [beforeEvidence] = await db
    .select({ status: schema.returns.status })
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.clientEvidenceReturnId));
  equal(beforeEvidence?.status, 'requested', 'rejected client request leaves lifecycle unchanged');

  const evidenceResponse = await clientApp.request(
    `/returns/${fixture.clientEvidenceReturnId}/inspection`,
    jsonRequest({ comments: 'Box arrived with a torn corner; photo attached.' }),
  );
  equal(evidenceResponse.status, 201, 'client can create a scoped evidence submission');
  const evidencePayload = await evidenceResponse.json() as {
    data: { id: number; status: string; condition: string | null; returnStatus: string };
  };
  equal(evidencePayload.data.status, 'pending', 'client evidence is pending operator review');
  equal(evidencePayload.data.condition, null, 'client evidence cannot create condition truth');
  equal(evidencePayload.data.returnStatus, 'requested', 'client evidence response reports unchanged lifecycle');

  inspections = await db
    .select()
    .from(schema.returnInspections)
    .where(eq(schema.returnInspections.returnId, fixture.clientEvidenceReturnId));
  equal(inspections.length, 1, 'client evidence appends one inspection-history row');
  equal(inspections[0]?.inspectorType, 'client', 'client evidence records client provenance');
  equal(inspections[0]?.inspectorEmail, clientActor.email, 'client evidence stamps server actor email');
  equal(inspections[0]?.receivedAt, null, 'client evidence cannot stamp warehouse receipt time');
  equal(inspections[0]?.condition, null, 'client evidence persists no authoritative condition');

  const [afterEvidence] = await db
    .select({ status: schema.returns.status })
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.clientEvidenceReturnId));
  equal(afterEvidence?.status, 'requested', 'client evidence does not advance returns.status');

  const crossTenant = await clientApp.request(
    `/returns/${fixture.otherReturnId}/inspection`,
    jsonRequest({ comments: 'Cross-tenant write attempt' }),
  );
  equal(crossTenant.status, 404, 'client cannot submit evidence outside canonical return scope');

  console.log('\nCP-045 Group 2 - operator owns receipt, condition, status, and lifecycle');
  const operatorInspection = await operatorApp.request(
    `/returns/${fixture.operatorReturnId}/inspection`,
    jsonRequest({
      receivedAt: '2026-07-17T02:00:00.000Z',
      condition: 'damaged',
      comments: 'Warehouse found package damage.',
    }),
  );
  equal(operatorInspection.status, 201, 'settings:write operator can record warehouse inspection');
  const operatorPayload = await operatorInspection.json() as {
    data: { id: number; status: string; condition: string | null; returnStatus: string };
  };
  equal(operatorPayload.data.status, 'failed', 'operator condition derives authoritative failed status');
  equal(operatorPayload.data.condition, 'damaged', 'operator condition is persisted');
  equal(operatorPayload.data.returnStatus, 'inspected', 'operator inspection advances lifecycle');

  const [operatorRow] = await db
    .select()
    .from(schema.returnInspections)
    .where(eq(schema.returnInspections.id, operatorPayload.data.id));
  equal(operatorRow?.inspectorType, 'operator', 'operator inspection records operator provenance');
  equal(operatorRow?.inspectorEmail, operatorActor.email, 'operator inspection stamps server actor email');

  const [operatorReturn] = await db
    .select({ status: schema.returns.status })
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.operatorReturnId));
  equal(operatorReturn?.status, 'inspected', 'only operator workflow advances returns.status');

  console.log('\nCP-045 Group 3 - media follows the same authority boundary');
  const storage = supabaseAdmin.storage as unknown as MockStorage;
  const originalFrom = storage.from;
  let uploadCalls = 0;
  storage.from = () => ({
    upload: async (path) => {
      uploadCalls += 1;
      return { data: { path }, error: null };
    },
  });
  try {
    const blockedOperatorMedia = await clientApp.request(
      `/returns/${fixture.operatorReturnId}/inspection/${operatorPayload.data.id}/media`,
      mediaRequest(),
    );
    equal(blockedOperatorMedia.status, 403, 'client cannot attach media to an operator inspection');
    equal(uploadCalls, 0, 'blocked operator-inspection media performs no storage upload');

    const evidenceMedia = await clientApp.request(
      `/returns/${fixture.clientEvidenceReturnId}/inspection/${evidencePayload.data.id}/media`,
      mediaRequest(),
    );
    equal(evidenceMedia.status, 201, 'client can attach media to its scoped evidence submission');
    equal(uploadCalls, 1, 'allowed client evidence performs exactly one storage upload');
  } finally {
    storage.from = originalFrom;
  }

  const mediaRows = await db
    .select()
    .from(schema.returnInspectionMedia)
    .where(eq(schema.returnInspectionMedia.inspectionId, evidencePayload.data.id));
  equal(mediaRows.length, 1, 'client evidence media persists once');
  equal(mediaRows[0]?.uploadedByEmail, clientActor.email, 'media records server actor provenance');

  const auditRows = await db
    .select({
      event: schema.clientPortalAuditLogs.event,
      actorEmail: schema.clientPortalAuditLogs.actorEmail,
    })
    .from(schema.clientPortalAuditLogs)
    .where(
      and(
        eq(schema.clientPortalAuditLogs.actorEmail, clientActor.email),
        eq(schema.clientPortalAuditLogs.event, 'portal.returns.inspection.authority_denied'),
      ),
    );
  equal(auditRows.length, 1, 'denied authority attempt is audited');
  equal(auditRows[0]?.actorEmail, clientActor.email, 'denied audit preserves actor provenance');
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\nPASS CP-045 return-inspection authority integration suite passed.\n'
      : `\nFAIL ${failures} CP-045 assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\nFAIL CP-045 return-inspection authority integration suite errored:',
    error instanceof Error ? error.stack : error,
  );
} finally {
  try {
    await reset();
  } catch {
    // Best-effort cleanup only; setupTestEnv already guarantees throwaway DB.
  }
  await pgClient.end({ timeout: 2 });
  process.exit(exitCode);
}

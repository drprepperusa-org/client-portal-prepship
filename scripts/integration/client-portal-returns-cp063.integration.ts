/* CP-063 — the returns detail DTO surfaces the current effective billing DAY (staff only).
 *
 * Runs the real return read route against a throwaway Postgres. The effective billing date is
 * the canonical UTC day of coalesce(billing_date_override, created_at) — the same rule PS-487
 * uses. This proves the detail DTO returns the override day when present, falls back to the
 * created_at day otherwise, reflects a correction on re-read (AC-2), and is gated to staff
 * (client users receive null so they cannot infer a correction occurred).
 *
 * Every network request is blocked; no provider, storage, or postage call is made.
 */
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  networkCalls += 1;
  throw new Error(`CP-063 integration blocked unexpected network request: ${String(input)}`);
}) as typeof fetch;

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { registerReturnReadRoutes } = await import('../../src/routes/client-portal/returns/reads');

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

// A staff (global) scope is what the ReturnBillingDatePanel runs under and is what
// effectiveBillingDate is gated to; a client_user scope must receive null for the field.
function appFor(clientId: number, opts: { global?: boolean } = {}): Hono {
  const routes = new Hono();
  registerReturnReadRoutes(routes);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'cp063-user' as never);
    c.set('email' as never, 'cp063@example.test' as never);
    c.set('role' as never, (opts.global ? 'admin' : 'client_user') as never);
    c.set('permissions' as never, [] as never);
    c.set('clientIds' as never, (opts.global ? [] : [clientId]) as never);
    c.set('storeIds' as never, [] as never);
    await next();
  });
  app.route('/', routes);
  return app;
}

async function reset(): Promise<void> {
  await db.execute(sql`
    truncate table
      return_activity_events,
      client_portal_audit_logs,
      returns,
      shipments,
      orders,
      clients
    restart identity cascade
  `);
  networkCalls = 0;
}

type Seed = { clientId: number; returnId: number; createdAtDay: string };

async function seedReturn(billingDateOverride: Date | null): Promise<Seed> {
  const [client] = await db
    .insert(schema.clients)
    .values({ name: 'CP-063 Client', isTest: false })
    .returning();
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: 'CP063-ORDER',
      orderStatus: 'shipped',
      clientId: client!.id,
      shipToName: 'CP-063 Customer',
      shipToCity: 'Los Angeles',
      shipToState: 'CA',
      shipToPostalCode: '90001',
      raw: { shipTo: { name: 'CP-063 Customer' } },
    })
    .returning();
  const [returnRow] = await db
    .insert(schema.returns)
    .values({
      orderId: order!.id,
      clientId: client!.id,
      returnReference: 'CP063-ORDER-RETURN',
      status: 'requested',
      initiatedBy: 'client',
      reason: 'CP-063 fixture',
      billingDateOverride,
    })
    .returning();
  return {
    clientId: client!.id,
    returnId: returnRow!.id,
    createdAtDay: (returnRow!.createdAt as Date).toISOString().slice(0, 10),
  };
}

type DetailBody = { data?: { effectiveBillingDate?: unknown }; error?: unknown };

async function staffNoOverrideFallsBackToCreatedDay(): Promise<void> {
  console.log('\nCP-063 - staff, no override: effectiveBillingDate is the created_at day');
  await reset();
  const seed = await seedReturn(null);
  const res = await appFor(seed.clientId, { global: true }).request(`/returns/${seed.returnId}`);
  const body = (await res.json()) as DetailBody;
  equal(res.status, 200, 'the staff-scoped detail is available');
  equal(
    body.data?.effectiveBillingDate,
    seed.createdAtDay,
    'with no override, the effective billing day is the created_at day (YYYY-MM-DD)',
  );
  equal(networkCalls, 0, 'the read makes no provider or storage network call');
}

async function staffOverrideWins(): Promise<void> {
  console.log('\nCP-063 - staff, override present: effectiveBillingDate is the override day');
  await reset();
  const seed = await seedReturn(new Date('2026-07-05T00:00:00.000Z'));
  const res = await appFor(seed.clientId, { global: true }).request(`/returns/${seed.returnId}`);
  const body = (await res.json()) as DetailBody;
  equal(res.status, 200, 'the staff-scoped detail is available');
  equal(body.data?.effectiveBillingDate, '2026-07-05', 'a billing_date_override day wins over created_at');
  check(
    body.data?.effectiveBillingDate !== seed.createdAtDay,
    'the corrected day is distinct from created_at (a saved correction is visible)',
  );
}

async function staffCorrectionRefetchReflectsNewDay(): Promise<void> {
  console.log('\nCP-063 - staff: after a correction, a re-read reflects the NEW day (AC-2)');
  await reset();
  const seed = await seedReturn(null);
  const staff = appFor(seed.clientId, { global: true });
  const first = (await (await staff.request(`/returns/${seed.returnId}`)).json()) as DetailBody;
  equal(first.data?.effectiveBillingDate, seed.createdAtDay, 'the first read shows the created_at day');
  // Simulate PS-487 applying a correction (the portal proxies this in production).
  await db
    .update(schema.returns)
    .set({ billingDateOverride: new Date('2026-07-07T00:00:00.000Z'), updatedAt: new Date() })
    .where(eq(schema.returns.id, seed.returnId));
  const second = (await (await staff.request(`/returns/${seed.returnId}`)).json()) as DetailBody;
  equal(
    second.data?.effectiveBillingDate,
    '2026-07-07',
    'the re-read reflects the corrected day, not the original',
  );
}

async function clientUserGetsNull(): Promise<void> {
  console.log('\nCP-063 - client user: the field is gated to null (no correction inference)');
  await reset();
  const seed = await seedReturn(new Date('2026-07-05T00:00:00.000Z'));
  const res = await appFor(seed.clientId).request(`/returns/${seed.returnId}`);
  const body = (await res.json()) as DetailBody;
  equal(res.status, 200, 'the in-scope return detail is still available to the client');
  equal(
    body.data?.effectiveBillingDate,
    null,
    'a client user never receives the effective billing date (staff-only)',
  );
}

async function main(): Promise<void> {
  await staffNoOverrideFallsBackToCreatedDay();
  await staffOverrideWins();
  await staffCorrectionRefetchReflectsNewDay();
  await clientUserGetsNull();
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\nPASS CP-063 effective-billing-day read-model integration.\n'
      : `\nFAIL ${failures} CP-063 assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\nFAIL CP-063 effective-billing-day integration errored:',
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

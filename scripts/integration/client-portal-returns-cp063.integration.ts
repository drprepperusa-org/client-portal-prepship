/* CP-063 — the returns detail DTO surfaces the current effective billing date.
 *
 * Runs the real return read route against a throwaway Postgres. The effective billing
 * date is coalesce(billing_date_override, created_at) — the same rule PS-487 uses. This
 * proves the detail DTO returns the override when present and falls back to created_at when
 * it is not, so the staff panel can show the current value instead of a blank form.
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

function appFor(clientId: number): Hono {
  const routes = new Hono();
  registerReturnReadRoutes(routes);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'cp063-user' as never);
    c.set('email' as never, 'cp063@example.test' as never);
    c.set('role' as never, 'client_user' as never);
    c.set('permissions' as never, [] as never);
    c.set('clientIds' as never, [clientId] as never);
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

type Seed = { clientId: number; returnId: number; createdAtIso: string };

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
    createdAtIso: (returnRow!.createdAt as Date).toISOString(),
  };
}

type DetailBody = { data?: { effectiveBillingDate?: unknown; createdAt?: unknown }; error?: unknown };

async function noOverrideFallsBackToCreatedAt(): Promise<void> {
  console.log('\nCP-063 - no override: effectiveBillingDate falls back to created_at');
  await reset();
  const seed = await seedReturn(null);
  const res = await appFor(seed.clientId).request(`/returns/${seed.returnId}`);
  const body = (await res.json()) as DetailBody;
  equal(res.status, 200, 'the in-scope return detail is available');
  equal(
    body.data?.effectiveBillingDate,
    seed.createdAtIso,
    'with no override, the effective billing date is created_at',
  );
  equal(networkCalls, 0, 'the read makes no provider or storage network call');
}

async function overrideWins(): Promise<void> {
  console.log('\nCP-063 - override present: effectiveBillingDate is the override');
  await reset();
  const override = new Date('2026-07-05T00:00:00.000Z');
  const seed = await seedReturn(override);
  const res = await appFor(seed.clientId).request(`/returns/${seed.returnId}`);
  const body = (await res.json()) as DetailBody;
  equal(res.status, 200, 'the in-scope return detail is available');
  equal(
    body.data?.effectiveBillingDate,
    override.toISOString(),
    'a billing_date_override wins over created_at',
  );
  check(
    body.data?.effectiveBillingDate !== seed.createdAtIso,
    'the corrected date is distinct from created_at (a saved correction is visible)',
  );
}

async function correctionRefetchReflectsNewValue(): Promise<void> {
  console.log('\nCP-063 - after a correction, a re-read reflects the NEW current value');
  await reset();
  const seed = await seedReturn(null);
  const first = await appFor(seed.clientId).request(`/returns/${seed.returnId}`);
  const firstBody = (await first.json()) as DetailBody;
  equal(firstBody.data?.effectiveBillingDate, seed.createdAtIso, 'the first read shows created_at');
  // Simulate PS-487 applying a correction (the portal proxies this in production).
  const corrected = new Date('2026-07-07T00:00:00.000Z');
  await db
    .update(schema.returns)
    .set({ billingDateOverride: corrected, updatedAt: new Date() })
    .where(eq(schema.returns.id, seed.returnId));
  const second = await appFor(seed.clientId).request(`/returns/${seed.returnId}`);
  const secondBody = (await second.json()) as DetailBody;
  equal(
    secondBody.data?.effectiveBillingDate,
    corrected.toISOString(),
    'the re-read reflects the corrected billing date, not the original (AC-2)',
  );
}

async function main(): Promise<void> {
  await noOverrideFallsBackToCreatedAt();
  await overrideWins();
  await correctionRefetchReflectsNewValue();
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\nPASS CP-063 effective-billing-date read-model integration.\n'
      : `\nFAIL ${failures} CP-063 assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\nFAIL CP-063 effective-billing-date integration errored:',
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

/* CP-061 Replace portal surface proof.
 *
 * Runs the replacement read models and the order badge derivation against a
 * throwaway Postgres. Proves: tenant scoping, badge truth (active / cancelled
 * cleared / rejected kept-with-status), reference passthrough, DTO redaction,
 * and the schema-readiness fail-soft when the tables are absent (their real
 * state in production today).
 */
import { sql as rawSql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { listPortalReplacements, getPortalReplacement } = await import(
  '../../src/lib/client-portal/read-models/replacements'
);
const { listPortalOrders } = await import('../../src/lib/client-portal/read-models/orders');
const { resetReplacementsSchemaReadinessCache } = await import(
  '../../src/lib/client-portal/replacements-schema-readiness'
);
const { clientPortalCapabilities } = await import('../../src/lib/client-portal/capabilities');
import type { ClientPortalScope } from '../../src/lib/client-portal/scope';

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

function scopeFor(clientIds: number[]): ClientPortalScope {
  return {
    kind: 'client-portal',
    userId: 'cp061-test-user',
    email: 'cp061@example.test',
    role: clientIds.length ? 'client_user' : 'admin',
    permissions: [],
    isGlobal: clientIds.length === 0,
    isRestricted: clientIds.length > 0,
    clientIds,
    storeIds: [],
    canViewFinancials: true,
  } as unknown as ClientPortalScope;
}

async function reset(): Promise<void> {
  await db.execute(rawSql`
    truncate table replacement_items, replacements, orders, clients restart identity cascade
  `);
  resetReplacementsSchemaReadinessCache();
}

let orderSeq = 0;
async function seedOrder(clientId: number): Promise<number> {
  orderSeq += 1;
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: `CP061-${orderSeq}`,
      orderStatus: 'shipped',
      clientId,
      orderDate: new Date(),
      shipToName: `Customer ${orderSeq}`,
    })
    .returning();
  return order!.id;
}

async function seedClient(name: string): Promise<number> {
  const [client] = await db.insert(schema.clients).values({ name, isTest: false }).returning();
  return client!.id;
}

async function seedReplacement(
  orderId: number,
  clientId: number,
  input: { reference: string; status?: string; reason?: string; items?: Array<{ sku: string; quantity: number }> },
): Promise<number> {
  const [row] = await db
    .insert(schema.replacements)
    .values({
      orderId,
      clientId,
      reference: input.reference,
      status: input.status ?? 'requested',
      reason: input.reason ?? 'damaged in transit',
    })
    .returning();
  for (const item of input.items ?? []) {
    await db.insert(schema.replacementItems).values({
      replacementId: row!.id,
      orderId,
      sku: item.sku,
      name: `Item ${item.sku}`,
      quantity: item.quantity,
    });
  }
  return row!.id;
}

async function orderBadge(orderId: number, scope: ClientPortalScope) {
  const page = await listPortalOrders(scope, { page: 1, pageSize: 50, search: '' });
  const dto = page.data.find((o: { id: number }) => o.id === orderId) as
    | {
        hasActiveReplacement: boolean;
        replacementStatus: string | null;
        replacementCount: number;
        replacementReference: string | null;
      }
    | undefined;
  return dto;
}

// ---------------------------------------------------------------------------
console.log('\nScenario 1: scoped list shows only the caller-visible client');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const clientB = await seedClient('CP061 B');
  const orderA = await seedOrder(clientA);
  const orderB = await seedOrder(clientB);
  await seedReplacement(orderA, clientA, { reference: 'CP061-1-REPLACE', items: [{ sku: 'A1', quantity: 2 }] });
  await seedReplacement(orderB, clientB, { reference: 'CP061-2-REPLACE' });
  const listA = await listPortalReplacements(scopeFor([clientA]));
  equal(listA.length, 1, 'client A sees exactly one replacement');
  equal(listA[0]?.reference, 'CP061-1-REPLACE', 'and it is their own');
  equal(listA[0]?.itemCount, 1, 'item count aggregates');
  const listAll = await listPortalReplacements(scopeFor([]));
  equal(listAll.length, 2, 'global scope sees both');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 2: cross-client detail answers 404-shaped null');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const clientB = await seedClient('CP061 B');
  const orderB = await seedOrder(clientB);
  const idB = await seedReplacement(orderB, clientB, { reference: 'CP061-3-REPLACE' });
  const denied = await getPortalReplacement(scopeFor([clientA]), idB);
  equal(denied, null, "client A cannot read client B's replacement");
  const allowed = await getPortalReplacement(scopeFor([clientB]), idB);
  equal(allowed?.reference, 'CP061-3-REPLACE', 'owner reads it fine');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 3: badge true for requested, with reference passthrough');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const orderA = await seedOrder(clientA);
  await seedReplacement(orderA, clientA, { reference: 'CP061-4-REPLACE' });
  const badge = await orderBadge(orderA, scopeFor([clientA]));
  equal(badge?.hasActiveReplacement, true, 'hasActiveReplacement true');
  equal(badge?.replacementStatus, 'requested', 'status passes through');
  equal(badge?.replacementCount, 1, 'count 1');
  equal(badge?.replacementReference, 'CP061-4-REPLACE', 'reference verbatim');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 4: cancelled clears the badge on the next read');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const orderA = await seedOrder(clientA);
  const id = await seedReplacement(orderA, clientA, { reference: 'CP061-5-REPLACE' });
  await db.execute(rawSql`update replacements set status = 'cancelled' where id = ${id}`);
  const badge = await orderBadge(orderA, scopeFor([clientA]));
  equal(badge?.hasActiveReplacement, false, 'badge cleared');
  equal(badge?.replacementCount, 0, 'count 0');
  equal(badge?.replacementReference, null, 'no reference');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 5: rejected KEEPS the badge with its status (pending PS-502 freeze)');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const orderA = await seedOrder(clientA);
  const id = await seedReplacement(orderA, clientA, { reference: 'CP061-6-REPLACE' });
  await db.execute(rawSql`update replacements set status = 'rejected' where id = ${id}`);
  const badge = await orderBadge(orderA, scopeFor([clientA]));
  equal(badge?.hasActiveReplacement, true, 'badge kept');
  equal(badge?.replacementStatus, 'rejected', 'status visible');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 6: two replacements — newest non-cancelled wins the badge');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const orderA = await seedOrder(clientA);
  await seedReplacement(orderA, clientA, { reference: 'CP061-7-REPLACE', status: 'shipped' });
  await db.execute(rawSql`update replacements set requested_at = now() - interval '1 day' where reference = 'CP061-7-REPLACE'`);
  await seedReplacement(orderA, clientA, { reference: 'CP061-7-REPLACE-2', status: 'requested' });
  const badge = await orderBadge(orderA, scopeFor([clientA]));
  equal(badge?.replacementCount, 2, 'count 2');
  equal(badge?.replacementStatus, 'requested', 'newest status');
  equal(badge?.replacementReference, 'CP061-7-REPLACE-2', 'newest reference, -2 suffix verbatim');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 7: DTO redaction — no internal/operator keys cross');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const orderA = await seedOrder(clientA);
  const id = await seedReplacement(orderA, clientA, {
    reference: 'CP061-8-REPLACE',
    items: [{ sku: 'R1', quantity: 1 }],
  });
  const detail = await getPortalReplacement(scopeFor([clientA]), id);
  const serialized = JSON.stringify(detail);
  const forbidden = [
    'reviewReason', 'adminOverride', 'approvedBy', 'idempotency', 'signature',
    'fingerprint', 'liabilityOwner', 'billable', 'stateVersion',
  ];
  check(
    forbidden.every((key) => !serialized.includes(key)),
    'no operator/internal key in the detail DTO',
  );
  const keys = Object.keys(detail ?? {}).sort().join(',');
  equal(
    keys,
    ['clientId', 'clientName', 'id', 'itemCount', 'items', 'orderId', 'orderNumber', 'reason', 'reference', 'requestedAt', 'status'].sort().join(','),
    'detail DTO keys are exactly the contract',
  );
}

// ---------------------------------------------------------------------------
console.log('\nScenario 8: capability gate — client_user cannot request, staff can');
{
  const clientScope = scopeFor([1]);
  const staffScope = scopeFor([]);
  equal(clientPortalCapabilities(clientScope as never).canRequestReplacements, false, 'client_user: no capability');
  equal(clientPortalCapabilities(staffScope as never).canRequestReplacements, true, 'global staff: capability');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 9: schema fail-soft — dropped tables mean empty, false, no throw');
await reset();
{
  const clientA = await seedClient('CP061 A');
  const orderA = await seedOrder(clientA);
  await db.execute(rawSql`drop table replacement_items`);
  await db.execute(rawSql`drop table replacements`);
  resetReplacementsSchemaReadinessCache();
  const list = await listPortalReplacements(scopeFor([clientA]));
  equal(list.length, 0, 'list empty without tables');
  const detail = await getPortalReplacement(scopeFor([clientA]), 1);
  equal(detail, null, 'detail null without tables');
  const badge = await orderBadge(orderA, scopeFor([clientA]));
  equal(badge?.hasActiveReplacement, false, 'orders list still serves; badge false');
  equal(badge?.replacementCount, 0, 'badge count 0');
}

// ---------------------------------------------------------------------------
await pgClient.end({ timeout: 5 });

if (failures > 0) {
  console.error(`\n✖ CP-061 integration: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\n✓ CP-061 Replace portal surface integration passed.');
process.exit(0);

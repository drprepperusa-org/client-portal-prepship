/**
 * READ-ONLY multi-tenant isolation validator.
 *
 * For each test account it:
 *   1. Reads the Supabase user's app_metadata to learn role + clientIds/storeIds
 *      (the same claims the auth middleware puts on the request context).
 *   2. Derives the ClientStoreScope exactly like the live API
 *      (src/lib/client-store-scope.ts).
 *   3. Resolves which clients/stores that scope maps to.
 *   4. Runs SELECT-only counts proving the scope predicate isolates data:
 *        - scoped vs. global counts for orders / inventory / shipments
 *        - an ESCALATION test: request a FOREIGN client's id under the user's
 *          scope → must return 0 (URL-param tampering is blocked at the query).
 *        - a LEAK test: rows visible to the user that belong to a non-assigned
 *          client → must be 0.
 *
 * Usage:  npx tsx scripts/validate-tenant-isolation.ts
 * Safe:   performs no writes. Requires DATABASE_URL + SUPABASE_URL +
 *         SUPABASE_SERVICE_ROLE_KEY in .env.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../src/db/client';
import { getClientStoreScope } from '../src/lib/client-store-scope';

const TEST_EMAILS = ['hkp@gmail.com', 'djc.portal.test@drprepper.local'];

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/** Build a Postgres `array[...]::int[]` literal (postgres.js can't bind a JS array directly). */
function arr(ids: number[]): SQL {
  if (!ids.length) return sql`array[]::int[]`;
  return sql`array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::int[]`;
}

function toIdList(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (typeof v === 'string') return v.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (typeof v === 'number') return [v];
  return [];
}

async function findUserByEmail(email: string) {
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 50 });
    if (error) throw error;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 50) break;
  }
  return null;
}

async function countOne(query: SQL): Promise<number> {
  const rows = await db.execute<{ c: number }>(query);
  return rows[0]?.c ?? 0;
}

async function countScoped(clientIds: number[], storeIds: number[]) {
  const ci = arr(clientIds);
  const si = arr(storeIds);
  return {
    orders: await countOne(sql`select count(*)::int as c from orders o where (o.client_id = any(${ci}) or o.store_id = any(${si}))`),
    inventory: await countOne(sql`
      select count(*)::int as c from inventory i
      where i.client_id = any(${ci})
         or exists (select 1 from clients c where c.id = i.client_id and c.store_ids && ${si})`),
    shipments: await countOne(sql`
      select count(*)::int as c from shipments s
      where s.client_id = any(${ci})
         or exists (select 1 from orders o where o.id = s.order_id and o.store_id = any(${si}))`),
  };
}

async function main() {
  console.log('\n=== Multi-Tenant Isolation Validation (read-only) ===\n');
  const totals = {
    orders: await countOne(sql`select count(*)::int as c from orders`),
    inventory: await countOne(sql`select count(*)::int as c from inventory`),
    shipments: await countOne(sql`select count(*)::int as c from shipments`),
  };
  console.log(`Global totals → orders: ${totals.orders}, inventory: ${totals.inventory}, shipments: ${totals.shipments}\n`);

  const allClients = await db.execute<{ id: number; name: string }>(sql`select id, name from clients order by id`);

  for (const email of TEST_EMAILS) {
    console.log('─'.repeat(72));
    console.log(`ACCOUNT: ${email}`);
    const user = await findUserByEmail(email);
    if (!user) {
      console.log('  ⚠ user not found in Supabase — skipping.\n');
      continue;
    }
    const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
    const clientIds = toIdList(meta.clientIds ?? meta.client_ids ?? meta.assignedClientIds ?? meta.assigned_client_ids);
    const storeIds = toIdList(meta.storeIds ?? meta.store_ids);
    const role = String(meta.role ?? '');
    const scope = getClientStoreScope({ email, role, permissions: (meta.permissions as string[]) ?? [], clientIds, storeIds });

    console.log(`  role=${role || '(none)'}  isGlobal=${scope.isGlobal}  isRestricted=${scope.isRestricted}`);
    console.log(`  clientIds=[${scope.clientIds.join(', ')}]  storeIds=[${scope.storeIds.join(', ')}]`);

    const assigned = await db.execute<{ id: number; name: string }>(sql`
      select id, name from clients
      where id = any(${arr(scope.clientIds)}) or store_ids && ${arr(scope.storeIds)}
      order by name`);
    console.log(`  Assigned stores/clients: ${assigned.map((a) => `${a.name} (#${a.id})`).join(', ') || '(none resolved)'}`);

    if (scope.isGlobal) {
      console.log('  → GLOBAL scope (admin): sees everything. Isolation asserts skipped.\n');
      continue;
    }

    const scoped = await countScoped(scope.clientIds, scope.storeIds);
    console.log(`  Visible → orders: ${scoped.orders}/${totals.orders}, inventory: ${scoped.inventory}/${totals.inventory}, shipments: ${scoped.shipments}/${totals.shipments}`);

    // Escalation: request a FOREIGN client's id under this scope → must be 0.
    const foreign = allClients.find((cl) => !scope.clientIds.includes(cl.id));
    if (foreign) {
      const leaked = await countOne(sql`
        select count(*)::int as c from orders o
        where (o.client_id = any(${arr(scope.clientIds)}) or o.store_id = any(${arr(scope.storeIds)}))
          and o.client_id = ${foreign.id}`);
      console.log(`  Escalation (?clientId=${foreign.id} "${foreign.name}") → rows: ${leaked}  ${leaked === 0 ? '✅ BLOCKED' : '❌ LEAK'}`);
    }

    // Leak: any visible order belonging to an unassigned client → must be 0.
    const leak = await countOne(sql`
      select count(*)::int as c from orders o
      where (o.client_id = any(${arr(scope.clientIds)}) or o.store_id = any(${arr(scope.storeIds)}))
        and o.client_id is not null
        and o.client_id <> all(${arr(scope.clientIds)})
        and not exists (select 1 from clients c where c.id = o.client_id and c.store_ids && ${arr(scope.storeIds)})`);
    console.log(`  Cross-tenant leak (visible rows from unassigned clients): ${leak}  ${leak === 0 ? '✅ NONE' : '❌ LEAK'}\n`);
  }

  console.log('─'.repeat(72));
  console.log('Done. (No writes performed.)\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});

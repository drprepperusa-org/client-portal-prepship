import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import postgres from 'postgres';

// Explicit, standalone migration; never executed by API startup or request handlers.
const source = readFileSync('drizzle/0053_portal_inbound_create_requests.sql', 'utf8').replace(/\r\n/g, '\n');
assert.equal(createHash('sha256').update(source).digest('hex'), '26be377c2c75734800f923e745067891b17b6663f0080019b05c5eaa93aa86a6');
const url = new URL(process.env.DATABASE_URL ?? '');
const target = process.argv.find(arg => arg.startsWith('--target='))?.slice(9);
if (target === 'local') {
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.startsWith('/portal_inbound_test'));
} else {
  assert.equal(target, 'production', 'Choose --target=local or --target=production explicitly');
  assert.ok(`${url.hostname}/${url.username}`.includes('fdkseckgfuvdczzqmnac'), 'Unexpected Supabase project');
  assert.equal(url.pathname, '/postgres');
}
const client = postgres(url.toString(), { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
async function inspect(db: any) {
  const [exists] = await db`select to_regclass('public.portal_inbound_create_requests') is not null as present`;
  if (!exists.present) return { present: false };
  const [state] = await db`select
    true as present,
    c.relrowsecurity as rls,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid=c.oid and contype='p') as primary_key,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid=c.oid and contype='f') as foreign_key,
    (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='portal_inbound_create_requests') as columns,
    to_regclass('public.portal_inbound_create_requests_inbound_idx') is not null as inbound_index,
    not exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated')
      and has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE')) as client_access_revoked,
    (c.relowner=(select oid from pg_roles where rolname=current_user)
      or (select rolbypassrls or rolsuper from pg_roles where rolname=current_user)) as backend_can_access
    from pg_class c where c.oid='public.portal_inbound_create_requests'::regclass`;
  return state;
}
function verify(state: any) {
  assert.equal(state.present, true); assert.equal(state.rls, true); assert.equal(state.columns, 5);
  assert.equal(state.primary_key, 'PRIMARY KEY (actor_user_id, request_key)');
  assert.match(state.foreign_key, /FOREIGN KEY \(inbound_id\) REFERENCES inbound_shipments\(id\) ON DELETE SET NULL/);
  assert.equal(state.inbound_index, true); assert.equal(state.client_access_revoked, true); assert.equal(state.backend_can_access, true);
}
try {
  const before = await inspect(client);
  if (process.argv.includes('--apply')) {
    assert.ok(process.argv.includes('--confirm=apply-portal-inbound-create-0053'), 'Explicit migration confirmation required');
    await client.begin(async tx => {
      await tx`set local lock_timeout='3s'`; await tx`set local statement_timeout='15s'`;
      await tx.unsafe(source);
      verify(await inspect(tx));
    });
    const after = await inspect(client); verify(after);
    console.log(JSON.stringify({ migration: '0053', target, applied: true, before, after }));
  } else console.log(JSON.stringify({ migration: '0053', target, applied: false, state: before }));
} finally { await client.end({ timeout: 5 }); }

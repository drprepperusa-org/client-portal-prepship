import assert from 'node:assert/strict';
import postgres from 'postgres';
import { loadFixtureModule } from './lib/load-fixture-module';

// Optional native release gate. Only loopback PostgreSQL is accepted; all writes
// are transaction-local temporary tables, dropped on commit/rollback. No providers.
const url = process.env.RATE_PIPELINE_PG_ADMIN_URL;
if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw Error('RATE_PIPELINE_PG_ADMIN_URL must name a disposable loopback PostgreSQL');
}
for (const mode of ['ESM', 'CJS']) {
  for (const max of [1, 4]) {
    const env = { DATABASE_URL: url, DB_POOL_MAX: max, DB_IDLE_TIMEOUT_SECONDS: 1, DB_MAX_LIFETIME_SECONDS: 900, DB_CONNECT_TIMEOUT_SECONDS: 5, DB_STATEMENT_TIMEOUT_MS: 5000 };
    const { sql } = loadFixtureModule('src/db/client.ts', {
      '../lib/env': { env }, ...(mode === 'ESM' ? { postgres } : {}),
    }) as { sql: postgres.Sql };
    try {
      await Promise.all(Array.from({ length: 8 }, async () => {
        await sql.begin(async tx => {
          await tx`create temporary table pipeline_fixture (n integer) on commit drop`;
          await tx`insert into pipeline_fixture values (${1}), (${2})`;
          const [count, sum] = await Promise.all([
            tx`select count(*)::int as n from pipeline_fixture`,
            tx`select sum(n)::int as n from pipeline_fixture where n >= ${1}`,
          ]);
          assert.equal(count[0].n, 2); assert.equal(sum[0].n, 3);
          await assert.rejects(tx.savepoint(async sp => {
            await sp`insert into pipeline_fixture values (${99})`;
            throw Error('rollback fixture');
          }), /rollback fixture/);
          assert.equal((await tx`select sum(n)::int as n from pipeline_fixture`)[0].n, 3);
        });
      }));
      await assert.rejects(sql.begin(async tx => { await tx`select 1`; throw Error('outer rollback'); }), /outer rollback/);
      assert.equal((await sql`select 1 as n`)[0].n, 1);
      assert.equal((await sql`select to_regclass('pg_temp.pipeline_fixture') as name`)[0].name, null);
      console.log(`PASS ${mode} max=${max}: eight transactions, parameterized/concurrent reads, commit, savepoint/outer rollback, follow-up`);
    } finally { await sql.end({ timeout: 2 }); }
  }
}


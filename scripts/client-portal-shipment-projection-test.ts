import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { orderOutboundShipmentMatchSql } from '../src/lib/client-portal/order-lifecycle';
import { loadFixtureModule } from './lib/load-fixture-module';

// Compare actual new SQL with the previous two-scalar projection, including
// its query plan. Ephemeral fixtures only; no env module or external database.
const source = readFileSync('src/lib/client-portal/read-models/orders.ts', 'utf8');
const start = source.indexOf('const activeShipmentIdentitySql');
const end = source.indexOf('\n)`;', start) + 4;
assert.ok(start > 0 && end > start);
const { projection } = loadFixtureModule('src/lib/client-portal/read-models/orders.ts', {
  __boundary: { sql, orderOutboundShipmentMatchSql },
}, `const { sql, orderOutboundShipmentMatchSql } = require('__boundary');\n${source.slice(start, end)}\nexport const projection = activeShipmentIdentitySql;`);
const scalar = (value: ReturnType<typeof sql>) => sql`(
  select ${value} from shipments s where ${orderOutboundShipmentMatchSql('s')}
    and coalesce(s.voided, false) = false
    and coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), '')) is not null
  order by s.id desc limit 1
)`;
const old = sql`select orders.id, jsonb_build_object(
  'trackingNumber', ${scalar(sql`coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), ''))`)},
  'carrierCode', ${scalar(sql`coalesce(nullif(trim(s.label_carrier), ''), nullif(trim(s.carrier_code), ''))`)}
) as identity from orders order by orders.id`;
const next = sql`select orders.id, ${projection()} as identity from orders order by orders.id`;
const dialect = new PgDialect({ casing: 'snake_case' });
const pg = new PGlite();
const query = (statement: ReturnType<typeof sql>) => {
  const built = dialect.sqlToQuery(statement);
  return pg.query<any>(built.sql, built.params);
};
try {
  await pg.exec(`
    create table orders(id int primary key, client_id int, order_number text);
    create table shipments(id int primary key, order_id int, client_id int, order_number text,
      is_return boolean, voided boolean, label_tracking text, tracking_number text, label_carrier text, carrier_code text);
    insert into orders values (1,1,'SAME'),(2,2,'SAME'),(3,1,'NONE'),(4,1,'VOID'),(5,1,'BLANK');
    insert into shipments values
      (1,1,1,'SAME',false,false,' LABEL ','fallback',' ups ','usps'),
      (2,null,2,'SAME',false,false,null,'OTHER',null,'fedex'),
      (3,1,1,'SAME',true,false,'RETURN',null,'usps',null),
      (4,1,1,'SAME',false,true,'VOIDED',null,'usps',null),
      (5,4,1,'VOID',false,true,'VOID-ONLY',null,'ups',null),
      (6,5,1,'BLANK',false,false,' ',null,'ups',null),
      (7,1,1,'SAME',false,false,' ', 'NEWEST', ' ', 'usps');
    insert into orders select g,1,'ORD-'||g from generate_series(6,1005) g;
    insert into shipments select 100+g*3+n,g,1,'ORD-'||g,false,false,'TRACK-'||g||'-'||n,null,'ups',null
      from generate_series(6,1005) g cross join generate_series(1,3) n;
    create index on shipments(order_id,id desc);
    create index on shipments(client_id,order_number,id desc) where order_id is null;
    analyze;
  `);
  const before = (await query(old)).rows;
  const after = (await query(next)).rows;
  assert.deepEqual(after.map(r => ({ ...r, identity: r.identity ?? { trackingNumber: null, carrierCode: null } })), before);
  assert.deepEqual(after[0].identity, { trackingNumber: 'NEWEST', carrierCode: 'usps' });
  assert.deepEqual(after[1].identity, { trackingNumber: 'OTHER', carrierCode: 'fedex' });
  assert.ok(after.slice(2, 5).every(row => row.identity === null));
  const plans = [];
  for (const statement of [old, next]) {
    const built = dialect.sqlToQuery(statement);
    const result = await pg.query<any>('explain (analyze, format json) ' + built.sql, built.params);
    const plan = result.rows[0]['QUERY PLAN'][0];
    const count = (node: any): number => (node['Parent Relationship'] === 'SubPlan' ? node['Actual Loops'] : 0)
      + (node.Plans ?? []).reduce((sum: number, child: any) => sum + count(child), 0);
    plans.push({ subplanExecutions: count(plan.Plan), executionMs: plan['Execution Time'] });
  }
  assert.equal(plans[0].subplanExecutions, 2010);
  assert.equal(plans[1].subplanExecutions, 1005);
  console.log(JSON.stringify({ rows: after.length, before: plans[0], after: plans[1], note: 'disposable PGlite plan, not production latency' }));
  console.log('PASS tracking/carrier parity: latest tracked outbound, voids, returns, blank values, client-scoped fallback, half the lookup executions');
} finally { await pg.close(); }

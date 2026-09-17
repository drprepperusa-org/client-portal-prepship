/** Real read models + CSV formatters on in-memory PostgreSQL. No network database. */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema';
import type { ClientPortalScope } from '../src/lib/client-portal/scope';

// Protect against an accidental un-substituted I/O boundary, even with a real .env.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/export_fixture';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.SUPABASE_JWT_SECRET = 'fixture';
const { db, sql: networkSql } = await import('../src/db/client');
const pg = new PGlite();
const memory = drizzle(pg, { casing: 'snake_case' });
const dialect = new PgDialect({ casing: 'snake_case' });
let counts = 0;
const instrument = (reader: any) => ({
  select(fields: any) {
    if (Object.keys(fields).join(',') === 'count') counts++;
    return reader.select(fields);
  },
  execute: async (query: any) => (await reader.execute(query)).rows,
});
const original = { select: db.select, execute: db.execute, transaction: db.transaction };
Object.assign(db, instrument(memory), {
  transaction: (callback: any, config: any) => {
    assert.deepEqual(config, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    return memory.transaction(tx => callback(instrument(tx)), config);
  },
});
const scope: ClientPortalScope = { userId: 'fixture', clientIds: [1], storeIds: [], isGlobal: false, isRestricted: true,
  permissions: [], canViewFinancials: false, canViewCredentials: false };

try {
  await pg.exec("set timezone to 'UTC'");
  for (const table of Object.values(schema)) {
    if (!(table instanceof PgTable)) continue;
    const columns = Object.values(getTableColumns(table)).map(column =>
      `"${dialect.casing.getColumnCasing(column)}" ${column.getSQLType()}`);
    await pg.exec(`create table if not exists "${getTableName(table)}" (${columns.join(',')})`);
  }
  await pg.exec(`
    create table store_accounts(id int, client_id int, provider text, sync_anchor_at timestamptz);
    insert into clients(id, name, active, store_ids) values (1,'Visible',true,array[101]),(2,'PRIVATE',true,array[102]);
    insert into inventory(id, sku, name, client_id, active, reorder_level, updated_at)
      select g, 'SKU-'||g, 'Item '||g, case when g=1002 then 2 else 1 end, true, 0, '2026-09-01'
      from generate_series(1,1002) g;
    insert into inventory_ledger(id,inventory_id,type,qty,effective_at,created_at,note)
      select g,g,'receive',g,'2026-09-01','2026-09-01','Receipt '||g from generate_series(1,1002) g;
    insert into orders(id,client_id,store_id,order_number,order_status,order_date,items)
      select g,case when g=1002 then 2 else 1 end,case when g=1002 then 102 else 101 end,
        'ORDER-'||g,'shipped','2026-09-01','[]'::jsonb from generate_series(1,1002) g;
    insert into order_items(id,order_id,line_index,sku,name,quantity,unit_price,line_total)
      select g,g,0,'SKU-'||g,'Item '||g,1,2,2 from generate_series(1,1002) g;
    insert into shipments(id,client_id,order_id,order_number,ship_date,voided,is_return,tracking_number)
      select g,case when g=1002 then 2 else 1 end,g,'ORDER-'||g,'2026-09-01',false,false,'TRACK-'||g
      from generate_series(1,1002) g;
  `);
  const surfaces = [
    ['inventory', 'inventory', 'listPortalInventory', 'exportPortalInventory', 'inventoryCsvHeader', 'inventoryCsvRow'],
    ['orders', 'order', 'listPortalOrders', 'exportPortalOrders', 'orderCsvHeader', 'orderCsvRow'],
    ['shipments', 'shipment', 'listPortalShipments', 'exportPortalShipments', 'shipmentCsvHeader', 'shipmentCsvRow'],
    ['inbound-receipts', 'inbound-receipt', 'listPortalInboundReceipts', 'exportPortalInboundReceipts', 'inboundReceiptCsvHeader', 'inboundReceiptCsvRow'],
  ];
  for (const [readName, name, listName, exportName, headerName, rowName] of surfaces) {
    const owner = await import(`../src/lib/client-portal/read-models/${readName}`);
    const exporter = await import(`../src/lib/client-portal/read-models/${name}-export`);
    const csv = await import(`../src/lib/client-portal/${name}-csv`);
    const filters = { search: '', lowStock: false, sortBy: name === 'inventory' ? 'sku' : name === 'inbound-receipt' ? 'receipt' : 'order', sortDir: 'asc' };
    const expected: string[] = [csv[headerName!](scope)];
    // Like the exporter, probe outside the reserved transaction (PGlite has one connection).
    const readiness = await import('../src/lib/client-portal/replacements-schema-readiness');
    const schemaReady = await readiness.replacementsSchemaReady();
    counts = 0;
    await db.transaction(async tx => {
      for (let page = 1; page <= 3; page++) {
        const result = await owner[listName!](scope, { ...filters, page, pageSize: 500 }, tx,
          ...(name === 'order' ? [schemaReady] : []));
        assert.equal(result.pagination.total, 1001);
        expected.push(...result.data.map((row: any) => csv[rowName!](row, scope)));
      }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    assert.equal(counts, 3, `${name}: baseline counts every page`);
    counts = 0;
    const result = await exporter[exportName!](scope, filters);
    assert.equal(result.rows, 1001);
    assert.equal(result.csv, expected.join(''), `${name}: optimized CSV is byte-identical, including sort and redaction`);
    assert.equal(counts, 1, `${name}: one count for all three pages`);
    assert.ok(!result.csv.includes('PRIVATE'));
    counts = 0;
    const empty = await exporter[exportName!]({ ...scope, clientIds: [999] }, filters);
    assert.equal(empty.rows, 0);
    assert.equal(counts, 1);
    const other = await exporter[exportName!]({ ...scope, clientIds: [2] }, filters);
    assert.equal(other.rows, 1, `${name}: another export has its own count and scope`);
    const store = await exporter[exportName!]({ ...scope, clientIds: [], storeIds: [102] }, filters);
    assert.equal(store.rows, 1, `${name}: store-only scope remains intact`);
    // Ordinary page requests still count fresh, never consuming an export's count.
    counts = 0;
    await owner[listName!](scope, { ...filters, page: 1, pageSize: 10 });
    await owner[listName!](scope, { ...filters, page: 2, pageSize: 10 });
    assert.equal(counts, 2);
    const snapshotArgs = name === 'order' ? [db, true, 1001] : [db, 1001];
    await assert.rejects(owner[listName!](scope, { ...filters, page: 1, pageSize: 10 }, ...snapshotArgs), /transaction reader/);
    console.log(`${name}: PASS — 1001 rows, 3 counts -> 1; identical CSV, empty/client/store isolation, fresh live reads`);
  }
} finally {
  Object.assign(db, original);
  await pg.close();
  await networkSql.end();
}

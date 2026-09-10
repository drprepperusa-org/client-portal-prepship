/** Runs actual ORDER BY expressions in disposable PostgreSQL; never opens a network DB. */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { sql, getTableColumns, getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema';
import { loadTableSortFields } from './lib/table-sort-fields-fixture';
import { tableOrderBy, referenceOrder } from '../src/lib/client-portal/read-models/table-sort';
import { firstShipmentItemSql } from '../src/lib/client-portal/read-models/shipment-item-sort';
import { isDiscountLine } from '../src/lib/client-portal/dashboard-aggregate';
import { INVOICE_SORT_FIELDS } from '../src/lib/client-portal/contracts/sorting';
import { CANONICAL_SORTABLE_KEYS, orderCanonicalEvents } from '../src/lib/client-portal/read-models/canonical-invoice-events';
import { portalReadKeys } from '../portal-client/src/lib/query-keys';
import { loadFixtureModule } from './lib/load-fixture-module';
import { returnReferenceSql, resolveReturnReference } from '../src/services/return-reference';

const db = new PGlite();
const dialect = new PgDialect({ casing: 'snake_case' });
async function run(query: SQL) {
  const built = dialect.sqlToQuery(query);
  return (await db.query(built.sql, built.params)).rows as Record<string, any>[];
}
try {
  for (const [persisted, number, id] of [['EXISTING-2', '10', 1], [null, ' Order 10 ', 2], ['', null, 3]] as const) {
    const [actual] = await run(sql`select ${returnReferenceSql(sql`${persisted}::text`, sql`${number}::text`, sql`${id}::int`)} as reference`);
    assert.equal(actual.reference, resolveReturnReference(persisted, number, id));
  }
  // Empty schema keeps this offline while PostgreSQL checks every real column/type/subquery.
  for (const table of Object.values(schema)) {
    if (!(table instanceof PgTable)) continue;
    const columns = Object.values(getTableColumns(table)).map(column =>
      `"${dialect.casing.getColumnCasing(column)}" ${column.getSQLType()}`);
    await db.exec(`create table if not exists "${getTableName(table)}" (${columns.join(',')});`);
  }
  for (const file of [
    'src/lib/client-portal/read-models/orders.ts', 'src/lib/client-portal/read-models/inventory.ts',
    'src/lib/client-portal/read-models/shipments.ts', 'src/lib/client-portal/read-models/inbound-receipts.ts',
    'src/routes/client-portal/inventory.ts', 'src/routes/client-portal/returns/reads.ts',
  ]) {
    const fields = loadTableSortFields(file, { isGlobal: true, canViewFinancials: true });
    for (const [key, expression] of Object.entries(fields)) {
      assert(expression, `${file}: ${key}`);
      await run(sql`select ${expression} from orders cross join clients cross join shipments
        cross join inventory cross join inventory_ledger cross join returns limit 0`);
    }
    const restricted = loadTableSortFields(file, { isGlobal: false, canViewFinancials: false });
    for (const key of ['weight', 'total', 'customerShipping', 'customerShippingRate', 'returnCustomerShippingRate']) {
      if (key in fields) assert.equal(restricted[key], undefined, `${file} blocks sorting on redacted ${key}`);
    }
  }
  await db.exec('create table fixture (id int, reference text, amount numeric);');
  const refs = ['10', '2', '9007199254740993', '9007199254740992', 'SKU-10', 'SKU-2', null, '2'];
  for (const [i, ref] of refs.entries()) await db.query('insert into fixture values ($1,$2,$3)', [i + 1, ref, i === 6 ? null : i + 0.5]);
  const id = sql`id`, fields = { reference: referenceOrder(sql`reference`), amount: sql`amount`, hidden: undefined };
  const fallback = [sql`id desc`];
  const ordered = (sortBy: string, sortDir: string, offset = 0) => run(sql`select * from fixture order by
    ${sql.join(tableOrderBy({ sortBy, sortDir }, fields, fallback, id), sql`, `)} limit 8 offset ${offset}`);
  assert.deepEqual((await ordered('reference', 'asc')).map(r => r.id), [2, 8, 1, 4, 3, 6, 5, 7]);
  assert.deepEqual((await ordered('reference', 'desc')).map(r => r.id), [5, 6, 3, 4, 1, 2, 8, 7]);
  assert.deepEqual((await ordered('reference', 'asc', 3)).map(r => r.id), [4, 3, 6, 5, 7]);
  assert.equal((await ordered('amount', 'asc')).at(-1)?.id, 7);
  assert.equal((await ordered('amount', 'desc')).at(-1)?.id, 7);
  for (const key of ['hidden', '__proto__', 'constructor', 'id desc; drop table fixture']) {
    assert.deepEqual((await ordered(key, 'desc')).map(r => r.id), [8, 7, 6, 5, 4, 3, 2, 1]);
  }

  // Shipment item sorting uses the same visible first item, including a leading promo line.
  for (const price of [-2, '-1.50', ' -2e1 ', '-Infinity', 'NaN', 'invalid', null, 0, 2]) {
    const items = [{ sku: 'PROMO', name: 'Discount', unitPrice: price }, { sku: 'SKU-2', name: 'Widget', unitPrice: 5 }];
    const expected = items.filter(item => !isDiscountLine(item))[0];
    const [actual] = await run(sql`select ${firstShipmentItemSql(sql`${JSON.stringify(items)}::jsonb`, 'sku')} as sku`);
    assert.equal(actual.sku, expected.sku.toLowerCase(), `first displayed item for price ${price}`);
  }
  for (const value of [null, {}, [], [null], [{ sku: 42 }]]) {
    const [actual] = await run(sql`select ${firstShipmentItemSql(sql`${JSON.stringify(value)}::jsonb`, 'sku')} as sku`);
    assert.equal(actual.sku, null);
  }

  // Execute the SQL and JS forms of the status owner against the same exhaustive signals.
  // CP-069: the owner reads PrepShip's lifecycle columns (order_status, canonical_status,
  // externally_shipped), the raw externallyFulfilled flag (booleanOrNull semantics) and the two
  // OUTBOUND row signals; carrier tracking is not an input. The SQL projection must agree with
  // the TS resolver on every combination, including the display-state gate.
  const ordersFixture = { orders: {
    id: sql`id`, orderNumber: sql`order_number`, clientId: sql`client_id`,
    orderStatus: sql`order_status`, canonicalStatus: sql`canonical_status`,
    externallyShipped: sql`externally_shipped`, raw: sql`raw`,
  } };
  const lifecycle = loadFixtureModule('src/lib/client-portal/order-lifecycle.ts', {
    '../../db/schema/orders': ordersFixture,
    '../../db/schema/shipments': { shipments: {
      isReturn: sql`is_return`, source: sql`source`, voided: sql`voided`,
      orderId: sql`order_id`, orderNumber: sql`order_number`, clientId: sql`client_id`,
    } },
  });
  const status = loadFixtureModule('src/lib/client-portal/order-status.ts', {
    '../../db/schema/orders': ordersFixture,
    './order-lifecycle': lifecycle,
    './order-fulfillment-signals': { orderFulfillmentSignalSelects: () => ({
      hasActiveOutboundShipment: sql`active`, hasVoidedOutboundShipment: sql`voided`,
    }) },
  });
  let statusCases = 0;
  for (const orderStatus of [null, 'cancelled', 'CANCELED', 'refunded', 'shipped', 'Shipped', 'awaiting_shipment', 'on_hold']) {
    for (const canonicalStatus of [null, 'cancelled', 'shipped', 'shipped_pending_confirmation', 'confirmation_failed']) {
      for (const externallyShipped of [false, true]) {
        for (const externallyFulfilled of [undefined, true, false, 'yes']) {
          for (const active of [false, true]) for (const voided of [false, true]) {
            const raw = externallyFulfilled === undefined ? {} : { externallyFulfilled };
            const [actual] = await run(sql`select ${status.orderFulfillmentStatusSql()} as status from
              (select ${orderStatus}::text as order_status, ${canonicalStatus}::text as canonical_status,
                ${externallyShipped}::boolean as externally_shipped, ${JSON.stringify(raw)}::jsonb as raw,
                ${active}::boolean as active, ${voided}::boolean as voided) signals`);
            const expected = status.resolveOrderFulfillmentStatus({
              orderStatus, canonicalStatus, externallyShipped,
              externallyFulfilled: lifecycle.rawExternallyFulfilled(raw),
              hasActiveOutboundShipment: active, hasVoidedOutboundShipment: voided,
            });
            assert.equal(actual.status, expected, JSON.stringify({ orderStatus, canonicalStatus, externallyShipped, raw, active, voided }));
            statusCases++;
          }
        }
      }
    }
  }

  // Every public Billing column must reach an allowed canonical field, in either direction.
  for (const key of Object.values(INVOICE_SORT_FIELDS)) {
    assert(CANONICAL_SORTABLE_KEYS.includes(key), key);
    const rows = [10, 2, 1].map(n => ({ canonicalEventId: `evt-${n}`, [key]: n }));
    assert.deepEqual(orderCanonicalEvents(rows as any, key, 'asc').map(r => r.canonicalEventId), ['evt-1', 'evt-2', 'evt-10']);
    assert.deepEqual(orderCanonicalEvents(rows as any, key, 'desc').map(r => r.canonicalEventId), ['evt-10', 'evt-2', 'evt-1']);
  }
  assert.deepEqual(portalReadKeys.orders(1), portalReadKeys.orders(1, undefined, undefined, 1, 50, undefined, undefined));
  assert.notDeepEqual(portalReadKeys.orders(1), portalReadKeys.orders(1, undefined, undefined, 1, 50, 'order', 'asc'));
  assert.notDeepEqual(portalReadKeys.inventory(1), portalReadKeys.inventory(1, '', 1, 100, false, 'sku', 'asc'));
  console.log(`PASS PostgreSQL sorting: all six column maps, permission gates, natural references, page boundaries, nulls, identity ties, item identity, ${statusCases} status cases, 19 Billing keys`);
} finally {
  await db.close();
}

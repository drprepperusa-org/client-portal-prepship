import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { auditActivityStorePredicate } from '../src/lib/client-portal/read-models/audit-log-store-attribution';

const targetStoreId = 424_242;
const compiled = new PgDialect().sqlToQuery(auditActivityStorePredicate(targetStoreId));

assert.match(compiled.sql, /jsonb_typeof\(.+"metadata"/s, 'filter checks explicit metadata attribution');
assert.ok(compiled.params.includes('storeId'), 'filter checks an explicit storeId metadata field');
assert.match(compiled.sql, /from "clients" audit_client/, 'filter resolves client ownership');
assert.match(compiled.sql, /from "orders" audit_order/, 'filter resolves order ownership');
assert.match(compiled.sql, /from "returns" audit_return/, 'filter resolves return ownership');
assert.match(compiled.sql, /from "shipments" audit_shipment/, 'filter resolves shipment ownership');
assert.match(compiled.sql, /from "inventory" audit_inventory/, 'filter resolves inventory ownership');
assert.match(
  compiled.sql,
  /cardinality\("client_portal_audit_logs"\."store_ids"\) = 1/,
  'session scope is only a fallback for unambiguous single-store sessions',
);
assert.ok(
  compiled.params.filter((value) => value === targetStoreId).length >= 8,
  'the selected store is applied to every attribution source',
);

console.log('ok: audit store filter uses event attribution instead of broad session scope');

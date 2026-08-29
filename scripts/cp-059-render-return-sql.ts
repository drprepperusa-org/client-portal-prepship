/*
 * CP-059 — render the return-postage SQL so a gate can compare it.
 *
 * Prints one JSON line: the compiled customer-safety gate and the compiled classification
 * predicate. scripts/prepship-return-vocabulary-parity.mjs execs this and requires the two to
 * normalise case identically, because review found them disagreeing: the aggregates lowercased
 * while the gate compared raw text, so a row spelled RETURN_LABEL was classified as return
 * postage AND skipped postage validation.
 *
 * Rendered rather than grepped on purpose — a comment or a plausible-looking spelling cannot
 * satisfy it, only the SQL that actually reaches Postgres.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { customerSafeBillingLineSql } from '../src/lib/client-portal/customer-shipping-rate';
import { isReturnPostageLineTypeSql } from '../src/services/billing-line-types';

const dialect = new PgDialect({ casing: 'snake_case' } as never);

const gate = dialect.sqlToQuery(
  customerSafeBillingLineSql({
    lineType: sql`b.line_type`,
    shipmentId: sql`b.shipment_id`,
    totalCost: sql`b.total_cost`,
  }),
).sql;

const classification = dialect.sqlToQuery(isReturnPostageLineTypeSql(sql`b.line_type`)).sql;

console.log(JSON.stringify({ gate, classification }));

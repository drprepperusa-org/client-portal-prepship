/*
 * CP-069 — render the order-lifecycle SQL so a gate can compare it.
 *
 * Prints one JSON line: the PgDialect-compiled text of the portal's port of PrepShip's
 * effective-status CASE (table form and alias form), the three bucket WHERE predicates that must
 * render on that INNER CASE (PS 0057's orders_effective_status_date_id_idx is built on exactly
 * that expression), and the customer-surface outbound admission predicate.
 * scripts/prepship-order-lifecycle-parity.mjs execs this and compares the output with the text
 * pinned in contracts/prepship-order-lifecycle-display.json.
 *
 * Rendered rather than grepped on purpose — a comment or a plausible-looking spelling cannot
 * satisfy it, only the SQL that actually reaches Postgres. Pattern: scripts/cp-059-render-return-sql.ts.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  orderLifecycleEffectiveStatusSql,
  orderLifecycleEffectiveStatusAliasSql,
  portalOrderFulfillmentBucketPredicateSql,
  outboundShipmentPredicate,
} from '../src/lib/client-portal/order-lifecycle';

const dialect = new PgDialect({ casing: 'snake_case' } as never);
const render = (query: SQL): string => dialect.sqlToQuery(query).sql;

console.log(
  JSON.stringify({
    effective: render(orderLifecycleEffectiveStatusSql()),
    alias: render(orderLifecycleEffectiveStatusAliasSql('o')),
    predicates: {
      pending: render(portalOrderFulfillmentBucketPredicateSql('pending')),
      shipped: render(portalOrderFulfillmentBucketPredicateSql('shipped')),
      cancelled: render(portalOrderFulfillmentBucketPredicateSql('cancelled')),
    },
    outbound: render(outboundShipmentPredicate()),
  }),
);

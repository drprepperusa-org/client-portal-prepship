import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { orders } from '../db/schema/orders';
import { returnItems, returns, type Return } from '../db/schema/returns';
import { orderScopePredicate } from '../lib/client-portal/predicates';
import { orderFulfillmentSignalSelects } from '../lib/client-portal/order-fulfillment-signals';
import type { ClientPortalScope } from '../lib/client-portal/scope';
import { resolveReturnEligibility } from './return-eligibility';

export class ReturnRequestRejectedError extends Error {
  constructor(message: string, public readonly status: 404 | 409,
    public readonly code = 'RETURN_NOT_ELIGIBLE') { super(message); }
}

// PS-486: source of truth for return-request persistence. Never trust eligibility
// from a browser or an earlier detail read. The order lock fences order lifecycle
// changes; re-read fulfillment after acquiring it, and insert header/items together.
export async function createReturnRequest(input: {
  scope: ClientPortalScope;
  orderId: number;
  values: Omit<typeof returns.$inferInsert, 'id' | 'orderId'>;
  items: Array<{ sku: string; name: string | null; quantity: number; orderItemId: number | null }>;
}): Promise<Return> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.id, input.orderId), orderScopePredicate(input.scope)))
      .for('update').limit(1);
    if (!locked) throw new ReturnRequestRejectedError('Order not found or outside your access scope', 404);
    const [facts] = await tx.select({ orderStatus: orders.orderStatus, ...orderFulfillmentSignalSelects() })
      .from(orders).where(eq(orders.id, locked.id)).limit(1);
    if (!facts) throw new ReturnRequestRejectedError('Order not found', 404);
    const eligibility = resolveReturnEligibility(facts);
    if (!eligibility.allowed) throw new ReturnRequestRejectedError(eligibility.reason, 409);
    const [created] = await tx.insert(returns).values({ ...input.values, orderId: locked.id }).returning();
    if (!created) throw new Error('Return creation did not return a record');
    await tx.insert(returnItems).values(input.items.map((item) => ({
      returnId: created.id, orderId: locked.id, orderItemId: item.orderItemId,
      sku: item.sku, name: item.name, quantity: String(item.quantity),
    })));
    return created;
  }).catch((error: unknown) => {
    // Drizzle wraps PostgreSQL errors; the outer message omits the constraint.
    const cause = (error as { cause?: { code?: string; constraint_name?: string } })?.cause;
    if (cause?.code === '23505' && cause.constraint_name === 'returns_one_active_per_order_idx') {
      throw new ReturnRequestRejectedError('An active return already exists for this order.', 409, 'RETURN_ALREADY_EXISTS');
    }
    throw error;
  });
}

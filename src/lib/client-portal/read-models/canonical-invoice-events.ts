/**
 * CP-059 — invoice detail rows at CANONICAL EVENT GRAIN.
 *
 * Replaces the business-row authority in `invoice-details.ts`, whose query grouped by
 * `b.client_id, c.name, b.order_id, b.order_number`. That grouping decided row grain locally:
 * an outbound event and every return on the same order collapsed into ONE row, and an absent
 * return amount became `0`. PrepShip already decides both, differently.
 *
 * WHAT THIS MODULE OWNS: forwarding scoped read intent, presentation-only enrichment,
 * deterministic sort, and pagination.
 *
 * WHAT IT MUST NEVER OWN: row grain, Outbound-vs-Return identity, reference strings,
 * destination classification, fee presence, or any arithmetic on money. Every one of those
 * arrives decided.
 *
 * The old read model stays in the file it lives in — `portalInvoiceSummary` and
 * `portalInvoicePeriodSummary` are separate aggregates and are NOT part of this cutover.
 */
import { db } from '../../../db/client.js';
import { sql } from 'drizzle-orm';
import type { ClientPortalScope } from '../scope.js';
import type { BillingInvoiceDetailRow } from '../contracts/billing.js';
import {
  fetchCanonicalBillingDetails,
  type CanonicalBillingEventRow,
  type CanonicalBillingDetailsResult,
} from '../prepship-billing-details-proxy.js';

export interface CanonicalInvoiceEventsInput {
  clientId?: number | null;
  dateFrom: string;
  dateTo: string;
  page?: number;
  pageSize?: number;
  sortBy?: string | null;
  sortDir?: string | null;
}

/**
 * Presentation-only enrichment, keyed by orderId ONLY.
 *
 * Item names and SKUs are display sugar the canonical row does not carry. Keying by orderId
 * means an outbound row and its returns show the same item text, which is correct — they
 * concern the same order.
 *
 * This lookup CANNOT create, drop or merge a row, and cannot touch identity, classification,
 * fee presence or money. If an order has no local item data the text is simply absent; the
 * canonical Return row still renders with its canonical money. An enrichment miss must never
 * be able to erase a billing event.
 */
async function itemTextByOrderId(orderIds: number[]): Promise<Map<number, { itemNames: string | null; skus: string | null }>> {
  const out = new Map<number, { itemNames: string | null; skus: string | null }>();
  if (orderIds.length === 0) return out;

  const rows = await db.execute<{ order_id: number; item_names: string | null; skus: string | null }>(sql`
    select
      oi.order_id,
      string_agg(distinct oi.name, ', ' order by oi.name) as item_names,
      string_agg(distinct oi.sku,  ', ' order by oi.sku)  as skus
    from order_items oi
    where oi.order_id = any(${sql.raw(`ARRAY[${orderIds.map((id) => Number(id)).join(',')}]::int[]`)})
    group by oi.order_id
  `);
  for (const row of rows) {
    out.set(Number(row.order_id), { itemNames: row.item_names ?? null, skus: row.skus ?? null });
  }
  return out;
}

/**
 * Sort keys the portal will honour. Deliberately narrow, and applied AFTER canonical grain so
 * sorting can reorder rows but never regroup them.
 *
 * `displayReference` is sortable as a LABEL. It is never used to derive identity, and sorting
 * by it must not change which rows exist — a point the fixture matrix asserts by feeding the
 * same events in reversed input order and requiring identical output.
 */
const SORTABLE = new Set([
  'orderNumber', 'displayReference', 'rowType', 'destination', 'clientName',
  'shipDate', 'actualActivityDate', 'billingEffectiveDate',
  'returnPostageTotal', 'returnProcessingTotal', 'grandTotal',
]);

function compareRows(a: CanonicalBillingEventRow, b: CanonicalBillingEventRow, key: string, dir: 1 | -1): number {
  const av = (a as unknown as Record<string, unknown>)[key];
  const bv = (b as unknown as Record<string, unknown>)[key];
  // Nulls sort last regardless of direction: a missing value is not "smaller", and letting it
  // float to the top of a money column would read as a zero.
  if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
  if (bv === null || bv === undefined) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
  return String(av).localeCompare(String(bv)) * dir;
}

/**
 * Stable tiebreak so pagination cannot drop or duplicate a row between pages.
 *
 * Uses relational identity — orderId then returnId — never `displayReference`. Two rows can
 * legitimately share a label; they cannot share (orderId, returnId).
 */
function stableKey(row: CanonicalBillingEventRow): string {
  return `${row.orderId ?? ''}|${row.returnId ?? ''}|${row.rowType ?? ''}`;
}

/**
 * Deterministic whole-set ordering, applied BEFORE any slicing.
 *
 * Exported so it can be executed directly. The behaviour under guard here — a whitelisted key,
 * nulls last, a stable relational tiebreak, and the sort covering the FULL filtered set rather
 * than the visible page — used to be asserted by matching SQL text in the order-grain read
 * model, which the detail path no longer calls. A guard reading an unreached implementation is
 * a guard reading nothing.
 *
 * Unknown or absent keys fall through to the tiebreak alone, which is a total order, so an
 * unrecognised sort never randomises the grid.
 */
export function orderCanonicalEvents(
  rows: readonly CanonicalBillingEventRow[],
  sortBy?: string | null,
  sortDir?: string | null,
): CanonicalBillingEventRow[] {
  const all = [...rows];
  const key = sortBy && SORTABLE.has(sortBy) ? sortBy : null;
  const dir: 1 | -1 = String(sortDir).toLowerCase() === 'desc' ? -1 : 1;
  all.sort((a, b) => {
    const primary = key ? compareRows(a, b, key, dir) : 0;
    return primary !== 0 ? primary : stableKey(a).localeCompare(stableKey(b));
  });
  return all;
}

export const CANONICAL_SORTABLE_KEYS: readonly string[] = [...SORTABLE];

export type CanonicalInvoiceEventsResult =
  | { ok: true; rows: BillingInvoiceDetailRow[]; total: number }
  | { ok: false; status: number; error: string; code: string };

/**
 * Fetch, enrich, sort and paginate canonical billing event rows.
 *
 * `total` counts EVENT ROWS, not distinct orders. An order with an outbound and two returns
 * contributes 3. The previous count grouped by order and reported 1, which meant pagination
 * totals disagreed with what the grid could show as soon as a return existed.
 */
export async function portalCanonicalInvoiceEvents(
  scope: ClientPortalScope,
  authorization: string,
  input: CanonicalInvoiceEventsInput,
  requestId?: string,
): Promise<CanonicalInvoiceEventsResult> {
  // Scope is enforced upstream against this same bearer. The clientId is forwarded as intent;
  // PrepShip re-authorizes it. The portal does not widen or narrow it here.
  const upstream: CanonicalBillingDetailsResult = await fetchCanonicalBillingDetails(
    authorization,
    {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    },
    requestId,
  );
  if (!upstream.ok) return upstream;

  // Deterministic order before any slicing.
  const all = orderCanonicalEvents(upstream.rows, input.sortBy, input.sortDir);

  const total = all.length;

  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.max(1, Number(input.pageSize) || total || 1);
  const slice = input.page ? all.slice((page - 1) * pageSize, page * pageSize) : all;

  const orderIds = [...new Set(slice.map((r) => r.orderId).filter((id): id is number => typeof id === 'number'))];
  const enrichment = await itemTextByOrderId(orderIds);

  const rows: BillingInvoiceDetailRow[] = slice.map((row) => {
    const extra = row.orderId === null ? undefined : enrichment.get(row.orderId);
    return {
      clientId: row.clientId ?? undefined,
      clientName: row.clientName,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      recipientName: row.recipientName,
      // Presentation-only. Absent enrichment leaves these null and changes nothing else.
      itemNames: extra?.itemNames ?? null,
      skus: extra?.skus ?? null,
      boxSize: row.boxSize,
      shipDate: row.shipDate,
      actualActivityDate: row.actualActivityDate,
      billingEffectiveDate: row.billingEffectiveDate,
      billingPolicyVersion: row.billingPolicyVersion,
      rolledFromWeekend: row.rolledFromWeekend ?? undefined,
      qty: row.qty,
      // Money, verbatim. Null stays null.
      pickpackTotal: row.pickpackTotal,
      additionalTotal: row.additionalTotal,
      packageTotal: row.packageTotal,
      shippingTotal: row.shippingTotal,
      storageTotal: row.storageTotal,
      returnPostageTotal: row.returnPostageTotal,
      returnProcessingTotal: row.returnProcessingTotal,
      returnTotal: row.returnTotal,
      rowTotal: row.grandTotal,
      // Canonical event identity.
      returnId: row.returnId,
      rowType: row.rowType,
      displayReference: row.displayReference,
      destination: row.destination,
      hasReturnPostageLine: row.hasReturnPostageLine,
      hasReturnProcessingLine: row.hasReturnProcessingLine,
    };
  });

  return { ok: true, rows, total };
}

// CP-061 — scoped Replace read model. SELECT-only over the canonical
// replacements/replacement_items mirror; tenant scope is the caller's order
// predicate (same authority as every other portal surface). All reads are
// gated on replacementsSchemaReady() and fail SOFT while the shared prod DB
// lacks the PS-502 tables.
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import type { ClientPortalScope } from '../scope';
import { rawOrderScopeForAlias } from '../predicates';
import { replacementsSchemaReady } from '../replacements-schema-readiness';
import type {
  PortalReplacementDetail,
  PortalReplacementItem,
  PortalReplacementRow,
} from '../contracts/replacements';

type ScopeFilters = { clientId?: number | null; storeId?: number | null };

type RawRow = {
  id: number;
  reference: string;
  order_id: number;
  order_number: string | null;
  client_id: number | null;
  client_name: string | null;
  status: string;
  reason: string;
  item_count: number;
  requested_at: string | null;
};

function toRow(row: RawRow): PortalReplacementRow {
  return {
    id: row.id,
    reference: row.reference,
    orderId: row.order_id,
    orderNumber: row.order_number,
    clientId: row.client_id,
    clientName: row.client_name,
    status: row.status,
    reason: row.reason,
    itemCount: Number(row.item_count ?? 0),
    requestedAt: row.requested_at,
  };
}

function scopePredicate(scope: ClientPortalScope, filters: ScopeFilters) {
  const predicate = rawOrderScopeForAlias(scope, filters);
  return predicate ? sql`and ${predicate}` : sql``;
}

export async function listPortalReplacements(
  scope: ClientPortalScope,
  filters: ScopeFilters = {},
): Promise<PortalReplacementRow[]> {
  if (!(await replacementsSchemaReady())) return [];
  const rows = await db.execute<RawRow>(sql`
    select
      r.id,
      r.reference,
      r.order_id,
      o.order_number,
      o.client_id,
      c.name as client_name,
      r.status,
      r.reason,
      (select count(*)::int from replacement_items ri where ri.replacement_id = r.id) as item_count,
      r.requested_at
    from replacements r
    join orders o on o.id = r.order_id
    left join clients c on c.id = o.client_id
    where true
      ${scopePredicate(scope, filters)}
    order by r.requested_at desc, r.id desc
    limit 200
  `);
  return rows.map(toRow);
}

export async function getPortalReplacement(
  scope: ClientPortalScope,
  id: number,
  filters: ScopeFilters = {},
): Promise<PortalReplacementDetail | null> {
  if (!(await replacementsSchemaReady())) return null;
  const [row] = await db.execute<RawRow>(sql`
    select
      r.id,
      r.reference,
      r.order_id,
      o.order_number,
      o.client_id,
      c.name as client_name,
      r.status,
      r.reason,
      (select count(*)::int from replacement_items ri where ri.replacement_id = r.id) as item_count,
      r.requested_at
    from replacements r
    join orders o on o.id = r.order_id
    left join clients c on c.id = o.client_id
    where r.id = ${id}
      ${scopePredicate(scope, filters)}
    limit 1
  `);
  if (!row) return null;
  const items = await db.execute<{ id: number; sku: string; name: string | null; quantity: number }>(sql`
    select ri.id, ri.sku, ri.name, ri.quantity
    from replacement_items ri
    where ri.replacement_id = ${row.id}
    order by ri.id asc
  `);
  const itemDtos: PortalReplacementItem[] = items.map((item: { id: number; sku: string; name: string | null; quantity: number }) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    quantity: Number(item.quantity ?? 0),
  }));
  return { ...toRow(row), items: itemDtos };
}

// Badge fragment for the order read model. Emitted per order alias `o`:
//   has_active_replacement — any replacement whose status <> 'cancelled'
//   replacement_status     — status of the NEWEST non-cancelled replacement
//   replacement_count      — count of non-cancelled replacements
//   replacement_reference  — reference of the newest non-cancelled replacement
//
// Cancellation clears the badge on the next canonical read (CP-061 AC-7).
// `rejected` currently KEEPS the badge with its status visible — the card
// freezes only cancelled-clears; revisit when PS-502 freezes the semantics.
export function orderReplacementBadgeLateralSql() {
  return sql`
    left join lateral (
      select
        count(*)::int                                   as replacement_count,
        (array_agg(r.status order by r.requested_at desc, r.id desc))[1]    as replacement_status,
        (array_agg(r.reference order by r.requested_at desc, r.id desc))[1] as replacement_reference
      from replacements r
      where r.order_id = o.id
        and r.status <> 'cancelled'
    ) order_replacements on true
  `;
}

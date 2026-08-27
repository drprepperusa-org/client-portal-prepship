// CP-061 — scoped Replace read model. SELECT-only over the canonical
// replacements/replacement_items mirror; tenant scope is the caller's order
// predicate (same authority as every other portal surface). All reads are
// gated on replacementsSchemaReady() and fail SOFT while the shared prod DB
// lacks the PS-502 tables.
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import type { ClientPortalScope } from '../scope';
import { rawOrderScopeForAlias } from '../predicates';
import { replacementsSchemaReady } from '../replacements-schema-readiness';
import { toReasonCode } from '../replacement-reason';
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
  reason: string | null;
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
    // Raw reason redacted to a canonical code (or null) — a non-canonical/legacy free-text
    // value never crosses; the frontend renders the label from the PS-502 contract.
    reasonCode: toReasonCode(row.reason),
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

// Badge selects for the order read model (drizzle .select fields). Emitted per
// order row, all four over the SAME predicate so they cannot disagree:
//   hasActiveReplacement — the order has a replacement in a NON-TERMINAL status
//   activeReplacementStatus    — status of the newest such replacement
//   activeReplacementCount     — how many there are
//   activeReplacementReference — reference of the newest such replacement
//
// "Active" is not a Client Portal invention. PS-502 froze the partition:
// REPLACEMENT_TERMINAL_STATUSES = ['completed', 'rejected', 'cancelled']
// (prepship-v4 src/services/replacement-state-machine.ts:45-49, with
// isReplacementTerminal() at :118-120 and ALLOWED_TRANSITIONS giving all three
// empty outbound arrays). This predicate is the direct transcription of
// !isReplacementTerminal(status) — the negative of the frozen set, not a
// positive list of our own, so a tenth upstream status cannot silently change
// what "active" means here. The nine legal statuses are pinned in
// contracts/replacements.ts and by the CP-061 guard; the DB domain is
// drizzle/0096_ps502_replacements.sql:70-73.
//
// This corrects a real defect. The predicate was `status <> 'cancelled'`, so a
// COMPLETED replacement kept a live REPLACE badge on the order forever, and a
// rejected one did too. It is invisible today only because the PS-502 tables
// are absent from the shared production database and the readiness gate below
// returns constants — the moment the operator lane runs, it would start
// emitting permanently-stuck badges.
//
// Cancellation still clears the badge on the next canonical read (CP-061 AC-7);
// completion and rejection now do the same, which is what the frozen state
// machine says.
//
// `ready` MUST be replacementsSchemaReady(): while the shared prod DB lacks
// the PS-502 tables, a subquery against them would 500 the entire Orders
// surface — not-ready emits constants instead.
export function orderReplacementBadgeSelects(ready: boolean, orderIdRef: SQL) {
  if (!ready) {
    return {
      hasActiveReplacement: sql<boolean>`false`,
      activeReplacementStatus: sql<string | null>`null::text`,
      activeReplacementCount: sql<number>`0::int`,
      activeReplacementReference: sql<string | null>`null::text`,
    };
  }
  return {
    hasActiveReplacement: sql<boolean>`exists (
      select 1 from replacements r
      where r.order_id = ${orderIdRef} and r.status not in ('completed', 'rejected', 'cancelled')
    )`,
    activeReplacementStatus: sql<string | null>`(
      select r.status from replacements r
      where r.order_id = ${orderIdRef} and r.status not in ('completed', 'rejected', 'cancelled')
      order by r.requested_at desc, r.id desc
      limit 1
    )`,
    activeReplacementCount: sql<number>`(
      select count(*)::int from replacements r
      where r.order_id = ${orderIdRef} and r.status not in ('completed', 'rejected', 'cancelled')
    )`,
    activeReplacementReference: sql<string | null>`(
      select r.reference from replacements r
      where r.order_id = ${orderIdRef} and r.status not in ('completed', 'rejected', 'cancelled')
      order by r.requested_at desc, r.id desc
      limit 1
    )`,
  };
}

import { sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderItems } from '../../../db/schema/order-items';
import { orderOverrides, orders } from '../../../db/schema/orders';
import {
  HERITAGE_PREP_FEE_CLIENT_NAME,
  heritagePrepFeeRowsForRange,
} from '../../heritage-prep-fee-overrides';
import { invoiceItemNameLinesSql } from '../invoice-items';
import { clientFilterPredicate, invoiceLineScopePredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';

/**
 * Invoice-detail read-model (extracted from routes/client-portal.ts): the
 * canonical per-order billing line rollup that powers /invoice-details and the
 * printable /invoice. Qty comes from canonical order_items quantities, never
 * from summed billing line quantities.
 */

type PortalInvoiceDetailRow = {
  client_id: number;
  client_name: string | null;
  order_id: number | null;
  order_number: string | null;
  recipient_name: string | null;
  item_names: string | null;
  skus: string | null;
  carrier_code: string | null;
  best_rate_dims: string | null;
  dim_l: string | null;
  dim_w: string | null;
  dim_h: string | null;
  ship_date: string | null;
  qty: string;
  pickpack_total: string;
  additional_total: string;
  package_total: string;
  shipping_total: string;
  storage_total: string;
  row_total: string;
};

export async function portalInvoiceDetails(scope: ClientPortalScope, input: { clientId?: number | null; dateFrom: string; dateTo: string }) {
  if (input.clientId) {
    const [client] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(clientFilterPredicate(scope, input.clientId, null))
      .limit(1);
    if (client?.name === HERITAGE_PREP_FEE_CLIENT_NAME) {
      const overrideRows = heritagePrepFeeRowsForRange(input.dateFrom, input.dateTo);
      if (overrideRows.length > 0) {
        return overrideRows.map((row) => ({
          clientId: client.id,
          clientName: client.name,
          orderId: null,
          orderNumber: row.orderNumber,
          recipientName: row.recipientName,
          itemNames: row.itemNames,
          skus: null,
          carrierCode: null,
          boxSize: null,
          shipDate: row.shipDate,
          qty: row.qty.toFixed(3),
          pickpackTotal: row.pickpackTotal.toFixed(2),
          additionalTotal: '0.00',
          packageTotal: row.packageTotal.toFixed(2),
          shippingTotal: row.shippingTotal.toFixed(2),
          storageTotal: row.storageTotal.toFixed(2),
          rowTotal: row.rowTotal.toFixed(2),
        }));
      }
    }
  }

  const rows = await db.execute<PortalInvoiceDetailRow>(sql`
    select
      b.client_id,
      c.name as client_name,
      b.order_id,
      b.order_number,
      max(o.ship_to_name) as recipient_name,
      ${invoiceItemNameLinesSql(sql`b.order_id`)} as item_names,
      (
        select string_agg(distinct oi.sku, ', ')
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.sku is not null
          and oi.sku <> ''
      ) as skus,
      max(o.carrier_code) as carrier_code,
      max(oo.best_rate_dims) as best_rate_dims,
      max(o.raw->'dimensions'->>'length') as dim_l,
      max(o.raw->'dimensions'->>'width') as dim_w,
      max(o.raw->'dimensions'->>'height') as dim_h,
      to_char(min(b.ship_date)::date, 'YYYY-MM-DD') as ship_date,
      coalesce((
        select sum(greatest(0, coalesce(oi.quantity, 0)))
        from ${orderItems} oi
        where oi.order_id = b.order_id
          and oi.quantity > 0
          and coalesce(oi.unit_price, 0) >= 0
      ), 0)::text as qty,
      coalesce(sum(case when b.line_type in ('pick_pack', 'pickpack') then b.total_cost else 0 end), 0)::text as pickpack_total,
      coalesce(sum(case when b.line_type in ('additional_unit', 'additional') then b.total_cost else 0 end), 0)::text as additional_total,
      coalesce(sum(case when b.line_type in ('package_cost', 'package') then b.total_cost else 0 end), 0)::text as package_total,
      coalesce(sum(case when b.line_type = 'shipping' then b.total_cost else 0 end), 0)::text as shipping_total,
      coalesce(sum(case when b.line_type = 'storage' then b.total_cost else 0 end), 0)::text as storage_total,
      coalesce(sum(b.total_cost), 0)::text as row_total
    from billing_line_items b
    left join ${clients} c on c.id = b.client_id
    left join ${orders} o on o.id = b.order_id
    left join ${orderOverrides} oo on oo.order_id = b.order_id
    where coalesce(c.active, true) = true
      and b.ship_date >= ${input.dateFrom}::timestamptz
      and b.ship_date <= ${input.dateTo}::timestamptz
      ${input.clientId ? sql`and b.client_id = ${input.clientId}` : sql``}
      ${invoiceLineScopePredicate(scope) ? sql`and ${invoiceLineScopePredicate(scope)}` : sql``}
    group by b.client_id, c.name, b.order_id, b.order_number
    order by min(b.ship_date) desc, b.order_id desc
    limit 1000
  `);

  const dimsFromRaw = (l: string | null, w: string | null, h: string | null): string | null => {
    const nl = Number(l);
    const nw = Number(w);
    const nh = Number(h);
    if ([nl, nw, nh].every((n) => Number.isFinite(n) && n > 0)) return `${nl}x${nw}x${nh}`;
    return null;
  };

  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    orderId: row.order_id,
    orderNumber: row.order_number,
    recipientName: row.recipient_name,
    itemNames: row.item_names,
    skus: row.skus,
    carrierCode: row.carrier_code,
    boxSize: row.best_rate_dims ?? dimsFromRaw(row.dim_l, row.dim_w, row.dim_h),
    shipDate: row.ship_date,
    qty: row.qty,
    pickpackTotal: row.pickpack_total,
    additionalTotal: row.additional_total,
    packageTotal: row.package_total,
    shippingTotal: row.shipping_total,
    storageTotal: row.storage_total,
    rowTotal: row.row_total,
  }));
}

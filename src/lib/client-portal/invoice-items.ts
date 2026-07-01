import { sql, type SQL } from 'drizzle-orm';
import { orderItems } from '../../db/schema/order-items';

export type InvoiceItemLine = {
  name?: string | null;
  quantity?: number | string | null;
  lineIndex?: number | null;
  unitPrice?: number | string | null;
};

function cleanQuantity(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, '');
}

export function formatInvoiceItemNameLines(items: InvoiceItemLine[]): string | null {
  const byName = new Map<string, { quantity: number; firstLineIndex: number }>();
  for (const item of items) {
    const name = item.name?.trim();
    const quantity = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || (Number.isFinite(unitPrice) && unitPrice < 0)) continue;
    const lineIndex = Number.isFinite(Number(item.lineIndex)) ? Number(item.lineIndex) : Number.MAX_SAFE_INTEGER;
    const current = byName.get(name);
    byName.set(name, {
      quantity: (current?.quantity ?? 0) + quantity,
      firstLineIndex: Math.min(current?.firstLineIndex ?? lineIndex, lineIndex),
    });
  }

  const lines = [...byName.entries()]
    .sort((a, b) => a[1].firstLineIndex - b[1].firstLineIndex || a[0].localeCompare(b[0]))
    .map(([name, item]) => `${name} x${cleanQuantity(item.quantity)}`);

  return lines.length ? lines.join('\n') : null;
}

export function invoiceItemNameLinesSql(orderId: SQL): SQL {
  const qtyExpr = sql`sum(greatest(0, coalesce(oi.quantity, 0)))`;
  return sql`(
    select string_agg(
      invoice_items.item_name || ' x' || trim(trailing '.' from trim(trailing '0' from invoice_items.item_qty::text)),
      chr(10)
      order by invoice_items.first_line_index, invoice_items.item_name
    )
    from (
      select
        btrim(oi.name) as item_name,
        min(oi.line_index) as first_line_index,
        ${qtyExpr} as item_qty
      from ${orderItems} oi
      where oi.order_id = ${orderId}
        and oi.name is not null
        and btrim(oi.name) <> ''
        and coalesce(oi.quantity, 0) > 0
        and coalesce(oi.unit_price, 0) >= 0
      group by btrim(oi.name)
      having ${qtyExpr} > 0
    ) invoice_items
  )`;
}
